import { describe, expect, it } from "vitest";
import { LeadIntakeService } from "../leads/lead-intake.service";
import { InMemoryLeadRepository } from "../leads/lead.repository";
import { InMemoryOperationsRepository } from "./operations.repository";
import { OperationsService } from "./operations.service";

const dataScope = "development";

function makeServices() {
  const leadRepository = new InMemoryLeadRepository();
  const leadService = new LeadIntakeService(leadRepository);
  const operationsRepository = new InMemoryOperationsRepository();
  const operationsService = new OperationsService(operationsRepository, leadService);
  return { leadService, operationsService };
}

async function createWonLead(leadService: LeadIntakeService) {
  const created = await leadService.createManualLead(dataScope, {
    businessName: "ABC Enterprises",
    phone: "9876543210",
    source: "MANUAL",
  });

  expect(created.outcome).toBe("created");

  if (created.outcome !== "created") {
    throw new Error("Lead was not created for test.");
  }

  return leadService.saveCallOutcome(dataScope, created.lead.id, {
    callOutcome: "SPOKE",
    conversationSummary: "Customer confirmed 4 camera installation for shop.",
    leadIntent: "INSTALLATION",
    followUpReason: "WON",
    wonDetails: {
      siteContactNumber: "9876543210",
      useCustomerPhoneAsSiteContact: true,
      address: "Jayanagar shop address",
      scopeOfWork: "Install 4 CCTV cameras with DVR setup.",
      scheduleStatus: "SCHEDULED",
      scheduledAt: "2026-06-10T05:30:00.000Z",
      quotedPriceRs: 25000,
      acceptedPriceRs: 23000,
      advancePaymentRs: 5000,
    },
  });
}

describe("OperationsService", () => {
  it("adds an individual vendor and blocks duplicate phone numbers", async () => {
    const { operationsService } = makeServices();

    const vendor = await operationsService.createVendor(dataScope, {
      vendorName: "CI4U Partner One",
      phone: "9123456789",
      workingAddress: "Jayanagar",
      address: "Jayanagar full address",
      pincode: "560011",
      dateOfBirth: "1995-01-01",
      experienceYears: 5,
      aadhaarDocumentName: "aadhaar.jpg",
      selfieDocumentName: "selfie.jpg",
      signatureReference: "signature-data-url",
      teamType: "INDIVIDUAL",
      skills: ["CCTV", "DVR"],
    });

    expect(vendor.phone).toBe("+919123456789");
    expect(vendor.teamSize).toBe(1);
    expect(vendor.kycStatus).toBe("VERIFICATION_PENDING");

    await expect(
      operationsService.createVendor(dataScope, {
        vendorName: "Duplicate Partner",
        phone: "+91 91234 56789",
        workingAddress: "Other",
        address: "Other address",
        pincode: "560012",
        dateOfBirth: "1994-01-01",
        experienceYears: 3,
        aadhaarDocumentName: "aadhaar2.jpg",
        selfieDocumentName: "selfie2.jpg",
        signatureReference: "signature-data-url",
        teamType: "INDIVIDUAL",
      }),
    ).rejects.toThrow("Vendor phone already exists");
  });

  it("requires team members when adding a team vendor", async () => {
    const { operationsService } = makeServices();

    await expect(
      operationsService.createVendor(dataScope, {
        vendorName: "Team Vendor",
        phone: "9123456790",
        workingAddress: "BTM",
        address: "BTM address",
        pincode: "560076",
        dateOfBirth: "1990-01-01",
        experienceYears: 8,
        aadhaarDocumentName: "aadhaar.jpg",
        selfieDocumentName: "selfie.jpg",
        signatureReference: "signature-data-url",
        teamType: "TEAM",
        teamSize: 2,
        teamMembers: [{ name: "Member One", aadhaarDocumentName: "m1.jpg" }],
      }),
    ).rejects.toThrow("Team member Aadhaar details must match");
  });

  it("creates a job from won details, assigns vendors, and keeps customer price out of vendor messages", async () => {
    const { leadService, operationsService } = makeServices();
    const wonLead = await createWonLead(leadService);
    const vendor = await operationsService.createVendor(dataScope, {
      vendorName: "Fast Partner",
      phone: "9123456791",
      workingAddress: "Jayanagar",
      address: "Vendor address",
      pincode: "560011",
      dateOfBirth: "1992-01-01",
      experienceYears: 6,
      aadhaarDocumentName: "aadhaar.jpg",
      selfieDocumentName: "selfie.jpg",
      signatureReference: "signature-data-url",
      teamType: "INDIVIDUAL",
      skills: ["CCTV"],
    });

    const job = await operationsService.createJobFromWonLead(dataScope, wonLead.id, "dev-founder");
    expect(job.status).toBe("WAITING_VENDOR_ASSIGNMENT");
    expect(job.scopeOfWork).toContain("4 CCTV");

    const assigned = await operationsService.assignJob(dataScope, job.id, "dev-founder", {
      vendorIds: [vendor.id],
      offerPriceRs: 18000,
    });

    expect(assigned.status).toBe("VENDOR_OFFER_SENT");
    expect(assigned.offers).toHaveLength(1);
    expect(assigned.offers[0]?.messageBody).toContain("Vendor offer price: Rs 18000");
    expect(assigned.offers[0]?.messageBody).not.toContain("23000");
    expect(assigned.offers[0]?.messageBody).not.toContain("25000");
  });

  it("runs work start, pause, resume, and completion certificate flow", async () => {
    const { leadService, operationsService } = makeServices();
    const wonLead = await createWonLead(leadService);
    const vendor = await operationsService.createVendor(dataScope, {
      vendorName: "Execution Partner",
      phone: "9123456792",
      workingAddress: "Jayanagar",
      address: "Vendor address",
      pincode: "560011",
      dateOfBirth: "1993-01-01",
      experienceYears: 4,
      aadhaarDocumentName: "aadhaar.jpg",
      selfieDocumentName: "selfie.jpg",
      signatureReference: "signature-data-url",
      teamType: "INDIVIDUAL",
    });
    const job = await operationsService.createJobFromWonLead(dataScope, wonLead.id, "dev-founder");
    const assigned = await operationsService.assignJob(dataScope, job.id, "dev-founder", {
      vendorIds: [vendor.id],
      offerPriceRs: 18000,
    });

    const started = await operationsService.startJob(dataScope, assigned.id, "dev-founder");
    expect(started.status).toBe("WORK_STARTED");
    expect(started.startedAt).not.toBeNull();

    const paused = await operationsService.pauseJob(dataScope, started.id, "dev-founder");
    expect(paused.status).toBe("WORK_PAUSED");

    const resumed = await operationsService.startJob(dataScope, paused.id, "dev-founder");
    expect(resumed.status).toBe("WORK_STARTED");

    await expect(
      operationsService.completeJob(dataScope, resumed.id, "dev-founder", {
        completionSummary: "Installation completed and customer confirmed mobile view.",
        vendorBonusRs: 500,
        vendorDeductionRs: 0,
      }),
    ).rejects.toThrow("completed-work photo is required");

    const withPhoto = await operationsService.addJobPhoto(dataScope, resumed.id, "dev-founder", {
      type: "COMPLETED_WORK",
      fileName: "completed-work.jpg",
      notes: "All camera points completed.",
    });
    expect(withPhoto.photos).toHaveLength(1);

    const withChecklist = await operationsService.saveJobChecklist(dataScope, resumed.id, "dev-founder", {
      type: "INSTALLATION",
      submit: true,
      items: [
        { id: "camera-installed", label: "Cameras installed", checked: true },
        { id: "recording-checked", label: "Recording checked", checked: true },
      ],
    });
    expect(withChecklist.checklists[0]?.status).toBe("SUBMITTED");

    const completed = await operationsService.completeJob(dataScope, withChecklist.id, "dev-founder", {
      completionSummary: "Installation completed and customer confirmed mobile view.",
      vendorBonusRs: 500,
      vendorDeductionRs: 0,
    });

    expect(completed.status).toBe("CLOSED");
    expect(completed.completionCertificateText).toContain("CI4U CUSTOMER WORK COMPLETION CERTIFICATE");
    expect(completed.completionCertificateText).toContain("Installation completed");
    expect(completed.certificates).toHaveLength(2);
    expect(completed.certificates.some((certificate) => certificate.audience === "CUSTOMER")).toBe(true);
    expect(completed.certificates.some((certificate) => certificate.audience === "VENDOR")).toBe(true);
    expect(completed.events.map((event) => event.type)).toContain("JOB_CLOSED");
    expect(completed.events.map((event) => event.type)).toContain("CERTIFICATE_CREATED");
  });
});
