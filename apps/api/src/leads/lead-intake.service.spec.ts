import { describe, expect, it, vi } from "vitest";
import { LeadIntakeService } from "./lead-intake.service";
import { InMemoryLeadRepository } from "./lead.repository";
import { type ExistingPhoneRecord } from "./lead.types";

const dataScope = "development";

function makeExistingPhone(overrides: Partial<ExistingPhoneRecord> = {}): ExistingPhoneRecord {
  return {
    dataScope,
    phoneNormalized: "+919876543210",
    customerId: "customer_1",
    customerName: "ABC Enterprises",
    currentLeadId: "lead_1",
    currentStage: "WARM",
    isActive: true,
    isArchived: false,
    assignedToName: "Rahul Verma",
    nextFollowUpAt: new Date("2026-06-01T10:00:00.000Z"),
    lastActivitySummary: "Customer asked to call next week.",
    lastUpdatedAt: new Date("2026-05-28T10:00:00.000Z"),
    totalJobs: 1,
    ...overrides,
  };
}

describe("LeadIntakeService", () => {
  it("creates a new raw lead when the normalized phone is not registered", async () => {
    const repository = new InMemoryLeadRepository();
    const service = new LeadIntakeService(repository);

    const result = await service.createManualLead(dataScope, {
      businessName: "ABC Enterprises",
      phone: "98765 43210",
      source: "MANUAL",
    });

    expect(result.outcome).toBe("created");

    if (result.outcome === "created") {
      expect(result.customer.primaryPhoneNormalized).toBe("+919876543210");
      expect(result.lead.currentStage).toBe("RAW_UNTOUCHED");
      expect(result.lead.leadCycleNumber).toBe(1);
      expect(result.activity.type).toBe("LEAD_CREATED");
    }
  });

  it("does not create a second customer for the same normalized phone", async () => {
    const repository = new InMemoryLeadRepository();
    const service = new LeadIntakeService(repository);

    await service.createManualLead(dataScope, {
      businessName: "ABC Enterprises",
      phone: "+91 9876543210",
      source: "MANUAL",
    });

    const duplicate = await service.createManualLead(dataScope, {
      businessName: "ABC Enterprises Duplicate",
      phone: "09876543210",
      source: "CSV",
    });

    expect(duplicate.outcome).toBe("duplicate");

    if (duplicate.outcome === "duplicate") {
      expect(duplicate.duplicate.phoneNormalized).toBe("+919876543210");
      expect(duplicate.suggestedActions).toContain("OPEN_EXISTING_RECORD");
      expect(duplicate.suggestedActions).not.toContain("REACTIVATE_TO_MASTER_LEADS");
    }
  });

  it("keeps development duplicate checks separate from production data scope", async () => {
    const repository = new InMemoryLeadRepository();
    const service = new LeadIntakeService(repository);

    const devLead = await service.createManualLead("development", {
      businessName: "Dev ABC Enterprises",
      phone: "+91 9876543210",
      source: "MANUAL",
    });
    const prodLead = await service.createManualLead("production", {
      businessName: "Prod ABC Enterprises",
      phone: "+91 9876543210",
      source: "MANUAL",
    });

    expect(devLead.outcome).toBe("created");
    expect(prodLead.outcome).toBe("created");
    expect(await service.listRawLeads("development")).toHaveLength(1);
    expect(await service.listRawLeads("production")).toHaveLength(1);
  });

  it("scopes queue lists, counts, details, and saves to the assigned user", async () => {
    const repository = new InMemoryLeadRepository();
    const service = new LeadIntakeService(repository);

    const first = await service.createManualLead(dataScope, {
      businessName: "Staff A Lead",
      phone: "9123400001",
      source: "MANUAL",
      assignedToId: "staff-a",
    });
    const second = await service.createManualLead(dataScope, {
      businessName: "Staff B Lead",
      phone: "9123400002",
      source: "MANUAL",
      assignedToId: "staff-b",
    });
    const staffAAccess = { actorId: "staff-a", canViewAllLeads: false };
    const managerAccess = { actorId: "manager", canViewAllLeads: true };

    expect(first.outcome).toBe("created");
    expect(second.outcome).toBe("created");

    if (first.outcome === "created" && second.outcome === "created") {
      expect(await service.listRawLeads(dataScope, staffAAccess)).toHaveLength(1);
      expect((await service.listRawLeads(dataScope, staffAAccess))[0]?.customerName).toBe("Staff A Lead");
      expect((await service.getQueueCounts(dataScope, staffAAccess)).RAW).toBe(1);
      expect((await service.getQueueCounts(dataScope, managerAccess)).RAW).toBe(2);
      expect(await service.getLeadDetail(dataScope, second.lead.id, staffAAccess)).toBeNull();

      await expect(
        service.saveCallOutcomeAck(
          dataScope,
          second.lead.id,
          {
            callOutcome: "WARM",
          },
          "staff-a",
          staffAAccess,
        ),
      ).rejects.toThrow("Lead was not found");
    }
  });

  it("offers reactivation when the duplicate record is archived", async () => {
    const repository = new InMemoryLeadRepository();
    repository.seedExistingPhone(
      makeExistingPhone({
        currentStage: "TRASH_ARCHIVED",
        isActive: false,
        isArchived: true,
      }),
    );
    const service = new LeadIntakeService(repository);

    const duplicate = await service.createManualLead(dataScope, {
      businessName: "ABC Enterprises",
      phone: "9876543210",
      source: "MANUAL",
    });

    expect(duplicate.outcome).toBe("duplicate");

    if (duplicate.outcome === "duplicate") {
      expect(duplicate.suggestedActions).toContain("REACTIVATE_TO_MASTER_LEADS");
    }
  });

  it("previews import rows with missing names, invalid phones, in-file duplicates, and existing duplicates", async () => {
    const repository = new InMemoryLeadRepository();
    repository.seedExistingPhone(makeExistingPhone());
    const service = new LeadIntakeService(repository);

    const preview = await service.previewImportRows(dataScope, [
      { rowNumber: 1, businessName: "Fresh Customer", phone: "9123456789" },
      { rowNumber: 2, businessName: "", phone: "9123456790" },
      { rowNumber: 3, businessName: "Bad Phone", phone: "12345" },
      { rowNumber: 4, businessName: "Existing Customer", phone: "9876543210" },
      { rowNumber: 5, businessName: "Fresh Duplicate", phone: "+91 9123456789" },
    ]);

    expect(preview.summary).toEqual({
      totalRows: 5,
      newRows: 1,
      duplicateRows: 2,
      invalidPhoneRows: 1,
      missingNameRows: 1,
      duplicateInFileRows: 1,
    });
    expect(preview.rows.map((row) => row.status)).toEqual([
      "NEW_VALID",
      "MISSING_NAME",
      "INVALID_PHONE",
      "DUPLICATE_ACTIVE",
      "DUPLICATE_IN_FILE",
    ]);
  });

  it("commits only valid new import rows and leaves duplicates skipped", async () => {
    const repository = new InMemoryLeadRepository();
    repository.seedExistingPhone(makeExistingPhone());
    const service = new LeadIntakeService(repository);

    const result = await service.commitImportRows(
      dataScope,
      [
        { rowNumber: 1, businessName: "Fresh Customer", phone: "9123456789" },
        { rowNumber: 2, businessName: "Existing Customer", phone: "9876543210" },
        { rowNumber: 3, businessName: "Bad Phone", phone: "12345" },
      ],
      "CSV",
    );

    expect(result.summary).toEqual({
      requestedRows: 3,
      createdRows: 1,
      skippedRows: 2,
    });
    expect(await service.listRawLeads(dataScope)).toHaveLength(1);
  });

  it("deletes only untouched raw leads and releases their phone numbers", async () => {
    const repository = new InMemoryLeadRepository();
    const service = new LeadIntakeService(repository);

    const first = await service.createManualLead(dataScope, {
      businessName: "Delete Me",
      phone: "9123456789",
      source: "MANUAL",
    });
    const second = await service.createManualLead(dataScope, {
      businessName: "Keep Warm",
      phone: "9123456790",
      source: "MANUAL",
    });

    expect(first.outcome).toBe("created");
    expect(second.outcome).toBe("created");

    if (first.outcome === "created" && second.outcome === "created") {
      await service.saveCallOutcome(dataScope, second.lead.id, {
        callOutcome: "WARM",
        followUpAt: "2026-06-01T05:30:00.000Z",
      });

      const result = await service.deleteRawLeads(
        dataScope,
        {
          leadIds: [first.lead.id, second.lead.id],
        },
        "manager_1",
      );

      expect(result.deletedLeadIds).toEqual([first.lead.id]);
      expect(result.skippedCount).toBe(1);
      expect(await service.listRawLeads(dataScope)).toHaveLength(0);
      expect(await service.listLeadsByQueue(dataScope, "WARM")).toHaveLength(1);

      const recreated = await service.createManualLead(dataScope, {
        businessName: "Delete Me Recreated",
        phone: "9123456789",
        source: "MANUAL",
      });

      expect(recreated.outcome).toBe("created");
    }
  });

  it("returns a raw lead detail with customer header data and first-call options", async () => {
    const repository = new InMemoryLeadRepository();
    const service = new LeadIntakeService(repository);

    const created = await service.createManualLead(dataScope, {
      businessName: "ABC Enterprises",
      phone: "9876543210",
      source: "MANUAL",
    });

    expect(created.outcome).toBe("created");

    if (created.outcome === "created") {
      const detail = await service.getLeadDetail(dataScope, created.lead.id);

      expect(detail).toMatchObject({
        id: created.lead.id,
        customerName: "ABC Enterprises",
        phoneNormalized: "+919876543210",
        currentStage: "RAW_UNTOUCHED",
      });
      expect(detail?.firstCallOutcomeOptions).toContain("SPOKE");
      expect(detail?.firstCallOutcomeOptions).toContain("WARM");
      expect(detail?.firstCallOutcomeOptions).toContain("WRONG_NUMBER");
      expect(detail?.firstCallOutcomeOptions).toHaveLength(5);
      expect(detail?.followUpOutcomeOptions).toContain("WRONG_NUMBER");
    }
  });

  it("archives a raw lead as Not Interested only when conversation summary is provided", async () => {
    const repository = new InMemoryLeadRepository();
    const service = new LeadIntakeService(repository);

    const created = await service.createManualLead(dataScope, {
      businessName: "NI Customer",
      phone: "9123456780",
      source: "MANUAL",
    });

    expect(created.outcome).toBe("created");

    if (created.outcome === "created") {
      await expect(
        service.saveCallOutcome(dataScope, created.lead.id, {
          callOutcome: "NOT_INTERESTED",
        }),
      ).rejects.toThrow("Conversation summary is required");

      const updated = await service.saveCallOutcome(dataScope, created.lead.id, {
        callOutcome: "NOT_INTERESTED",
        conversationSummary: "Customer said service is not required now.",
      });

      expect(updated.currentStage).toBe("NOT_INTERESTED");
      expect(updated.isArchived).toBe(true);
      expect(await service.listRawLeads(dataScope)).toHaveLength(0);
      expect(await service.listLeadsByQueue(dataScope, "ARCHIVE")).toHaveLength(1);
    }
  });

  it("moves a direct warm outcome to Warm with optional summary and Nurture follow-up", async () => {
    const repository = new InMemoryLeadRepository();
    const service = new LeadIntakeService(repository);

    const created = await service.createManualLead(dataScope, {
      businessName: "Warm Customer",
      phone: "9123456781",
      source: "MANUAL",
    });

    expect(created.outcome).toBe("created");

    if (created.outcome === "created") {
      const updated = await service.saveCallOutcome(dataScope, created.lead.id, {
        callOutcome: "WARM",
        followUpAt: "2026-06-01T05:30:00.000Z",
      });

      expect(updated.currentStage).toBe("WARM");
      expect(updated.currentIntent).toBe("WARM");
      expect(updated.followUpReason).toBe("NURTURE");
      expect(updated.priority).toBe("MEDIUM");
      expect(updated.timeline.at(-1)?.summary).toContain("Summary not provided");
      expect(await service.listLeadsByQueue(dataScope, "WARM")).toHaveLength(1);
    }
  });

  it("returns a compact server-confirmed ack for fast lead saves", async () => {
    const repository = new InMemoryLeadRepository();
    const service = new LeadIntakeService(repository);

    const created = await service.createManualLead(dataScope, {
      businessName: "Fast Ack Customer",
      phone: "9123456791",
      source: "MANUAL",
    });

    expect(created.outcome).toBe("created");

    if (created.outcome === "created") {
      const ack = await service.saveCallOutcomeAck(dataScope, created.lead.id, {
        callOutcome: "WARM",
      });

      expect(ack.serverConfirmed).toBe(true);
      expect(ack.currentStage).toBe("WARM");
      expect(ack.lastActivitySummary).toContain("Warm lead marked");
      expect("timeline" in ack).toBe(false);
      expect("quotationSuggestions" in ack).toBe(false);
    }
  });

  it("moves a hot installation lead with scheduled site visit using visit time as follow-up", async () => {
    const repository = new InMemoryLeadRepository();
    const service = new LeadIntakeService(repository);

    const created = await service.createManualLead(dataScope, {
      businessName: "Installation Customer",
      phone: "9123456782",
      source: "MANUAL",
    });

    expect(created.outcome).toBe("created");

    if (created.outcome === "created") {
      const updated = await service.saveCallOutcome(dataScope, created.lead.id, {
        callOutcome: "SPOKE",
        leadIntent: "INSTALLATION",
        conversationSummary: "Customer needs four cameras for shop.",
        followUpReason: "SITE_VISIT",
        siteVisitStatus: "SCHEDULED",
        siteVisitScheduledAt: "2026-06-02T06:00:00.000Z",
      });

      expect(updated.currentStage).toBe("HOT_INSTALLATION");
      expect(updated.followUpReason).toBe("SITE_VISIT");
      expect(updated.siteVisitStatus).toBe("SCHEDULED");
      expect(updated.nextFollowUpAt?.toISOString()).toBe("2026-06-02T06:00:00.000Z");
      expect(await service.listLeadsByQueue(dataScope, "HOT_INSTALLATION")).toHaveLength(1);
    }
  });

  it("moves a repair/service lead to Won without vendor workflow for now", async () => {
    const repository = new InMemoryLeadRepository();
    const service = new LeadIntakeService(repository);

    const created = await service.createManualLead(dataScope, {
      businessName: "Won Repair Customer",
      phone: "9123456783",
      source: "MANUAL",
    });

    expect(created.outcome).toBe("created");

    if (created.outcome === "created") {
      const updated = await service.saveCallOutcome(dataScope, created.lead.id, {
        callOutcome: "SPOKE",
        leadIntent: "REPAIR_SERVICE",
        conversationSummary: "Customer confirmed repair visit and pricing.",
        followUpReason: "WON",
        wonDetails: {
          siteContactNumber: "9123456783",
          useCustomerPhoneAsSiteContact: true,
          address: "Jayanagar shop",
          scopeOfWork: "Repair two CCTV cameras.",
          scheduleStatus: "SCHEDULED",
          scheduledAt: "2026-06-02T06:00:00.000Z",
          quotedPriceRs: 5000,
          acceptedPriceRs: 4500,
          advancePaymentRs: 1000,
        },
      });

      expect(updated.currentStage).toBe("CAPTURED_WON");
      expect(updated.followUpReason).toBe("WON");
      expect(updated.wonDetails?.acceptedPricePaise).toBe(450000);
      expect(await service.listLeadsByQueue(dataScope, "WON")).toHaveLength(1);
    }
  });

  it("keeps not-receiving leads in Unanswered with escalating auto follow-ups before final archive", async () => {
    const repository = new InMemoryLeadRepository();
    const service = new LeadIntakeService(repository);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-31T00:00:00.000Z"));

    try {
      const created = await service.createManualLead(dataScope, {
        businessName: "Not Receiving Customer",
        phone: "9123456784",
        source: "MANUAL",
      });

      expect(created.outcome).toBe("created");

      if (created.outcome === "created") {
        const first = await service.saveCallOutcome(dataScope, created.lead.id, { callOutcome: "NOT_RECEIVING" });
        const second = await service.saveCallOutcome(dataScope, created.lead.id, { callOutcome: "NOT_RECEIVING" });
        await service.saveCallOutcome(dataScope, created.lead.id, { callOutcome: "NOT_RECEIVING" });
        await service.saveCallOutcome(dataScope, created.lead.id, { callOutcome: "NOT_RECEIVING" });
        await service.saveCallOutcome(dataScope, created.lead.id, { callOutcome: "NOT_RECEIVING" });
        const sixth = await service.saveCallOutcome(dataScope, created.lead.id, { callOutcome: "NOT_RECEIVING" });
        const archived = await service.saveCallOutcome(dataScope, created.lead.id, { callOutcome: "NOT_RECEIVING" });

        expect(first.currentStage).toBe("NOT_RECEIVING");
        expect(first.nextFollowUpAt?.toISOString()).toBe("2026-05-31T03:00:00.000Z");
        expect(second.nextFollowUpAt?.toISOString()).toBe("2026-06-01T00:00:00.000Z");
        expect(sixth.nextFollowUpAt?.toISOString()).toBe("2026-08-29T00:00:00.000Z");
        expect(archived.currentStage).toBe("NOT_RECEIVING_FINAL");
        expect(archived.notReceivingCount).toBe(7);
        expect(archived.isArchived).toBe(true);
        expect(await service.listLeadsByQueue(dataScope, "UNANSWERED")).toHaveLength(0);
        expect(await service.listLeadsByQueue(dataScope, "ARCHIVE")).toHaveLength(1);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("saves quotation catalog and uses contextual hot not-receiving schedule", async () => {
    const repository = new InMemoryLeadRepository();
    const service = new LeadIntakeService(repository);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-31T00:00:00.000Z"));

    try {
      const created = await service.createManualLead(dataScope, {
        businessName: "Ghosting Installation Customer",
        phone: "9123456785",
        source: "MANUAL",
      });

      expect(created.outcome).toBe("created");

      if (created.outcome === "created") {
        const quoted = await service.saveCallOutcome(dataScope, created.lead.id, {
          callOutcome: "SPOKE",
          leadIntent: "INSTALLATION",
          conversationSummary: "Customer needs CCTV for shop but did not answer later.",
          followUpReason: "QUOTATION",
          followUpAt: "2026-06-01T05:30:00.000Z",
          quotation: {
            title: "Shop CCTV",
            packages: [
              {
                packageName: "4 Camera Package",
                multiplier: 2,
                items: [
                  { itemName: "CCTV A", unitPriceRs: 1200 },
                  { itemName: "SMPS", unitPriceRs: 1300 },
                ],
              },
            ],
          },
        });

        expect(quoted.latestQuotation?.totalPricePaise).toBe(500000);
        expect(quoted.quotationSuggestions.items.map((item) => item.itemName)).toContain("CCTV A");
        expect(quoted.quotationSuggestions.packages.map((pkg) => pkg.packageName)).toContain("4 Camera Package");

        const first = await service.saveCallOutcome(dataScope, created.lead.id, { callOutcome: "NOT_RECEIVING" });
        const second = await service.saveCallOutcome(dataScope, created.lead.id, { callOutcome: "NOT_RECEIVING" });

        expect(first.nextFollowUpAt?.toISOString()).toBe("2026-05-31T03:00:00.000Z");
        expect(second.nextFollowUpAt?.toISOString()).toBe("2026-06-01T00:00:00.000Z");
        expect(second.isArchived).toBe(false);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("defaults warm follow-up to one month when staff does not override it", async () => {
    const repository = new InMemoryLeadRepository();
    const service = new LeadIntakeService(repository);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-31T00:00:00.000Z"));

    try {
      const created = await service.createManualLead(dataScope, {
        businessName: "Default Warm Customer",
        phone: "9123456786",
        source: "MANUAL",
      });

      expect(created.outcome).toBe("created");

      if (created.outcome === "created") {
        const updated = await service.saveCallOutcome(dataScope, created.lead.id, {
          callOutcome: "WARM",
        });

        expect(updated.currentStage).toBe("WARM");
        expect(updated.nextFollowUpAt?.toISOString()).toBe("2026-06-30T00:00:00.000Z");
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("surfaces due follow-up alerts and enforces the three-snooze limit", async () => {
    const repository = new InMemoryLeadRepository();
    const service = new LeadIntakeService(repository);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-09T10:00:00.000Z"));

    try {
      const created = await service.createManualLead(dataScope, {
        businessName: "Alert Customer",
        phone: "9123456792",
        source: "MANUAL",
        assignedToId: "staff-a",
      });

      expect(created.outcome).toBe("created");

      if (created.outcome === "created") {
        await service.saveCallOutcome(dataScope, created.lead.id, {
          callOutcome: "WARM",
          followUpAt: "2026-06-09T09:59:00.000Z",
        });

        const alerts = await service.listDueFollowUpAlerts(dataScope, "staff-a");
        expect(alerts).toHaveLength(1);
        const alert = alerts[0];
        expect(alert).toBeDefined();
        expect(alert).toMatchObject({
          customerName: "Alert Customer",
          reason: "NURTURE",
          snoozeCount: 0,
          maxSnoozes: 3,
        });

        const first = await service.snoozeFollowUpAlert(dataScope, alert!.id, { minutes: 5 }, "staff-a");
        expect(first.snoozeCount).toBe(1);
        expect(first.snoozedUntil?.toISOString()).toBe("2026-06-09T10:05:00.000Z");
        expect(await service.listDueFollowUpAlerts(dataScope, "staff-a")).toHaveLength(0);

        await service.snoozeFollowUpAlert(dataScope, alert!.id, { minutes: 5 }, "staff-a");
        const third = await service.snoozeFollowUpAlert(dataScope, alert!.id, { minutes: 5 }, "staff-a");
        expect(third.snoozeCount).toBe(3);

        await expect(service.snoozeFollowUpAlert(dataScope, alert!.id, { minutes: 5 }, "staff-a")).rejects.toThrow("snoozed 3 times");
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("holds a due alert when staff chooses handle now", async () => {
    const repository = new InMemoryLeadRepository();
    const service = new LeadIntakeService(repository);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-09T10:00:00.000Z"));

    try {
      const created = await service.createManualLead(dataScope, {
        businessName: "Handle Now Customer",
        phone: "9123456793",
        source: "MANUAL",
        assignedToId: "staff-a",
      });

      expect(created.outcome).toBe("created");

      if (created.outcome === "created") {
        await service.saveCallOutcome(dataScope, created.lead.id, {
          callOutcome: "WARM",
          followUpAt: "2026-06-09T09:59:00.000Z",
        });

        const [alert] = await service.listDueFollowUpAlerts(dataScope, "staff-a");
        expect(alert).toBeDefined();
        const held = await service.holdFollowUpForHandling(dataScope, alert!.id, "staff-a");

        expect(held.snoozedUntil?.toISOString()).toBe("2026-06-09T10:15:00.000Z");
        expect(held.snoozeCount).toBe(0);
        expect(await service.listDueFollowUpAlerts(dataScope, "staff-a")).toHaveLength(0);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows transferred leads in the receiver's due follow-up alerts", async () => {
    const repository = new InMemoryLeadRepository();
    const service = new LeadIntakeService(repository);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-09T10:00:00.000Z"));

    try {
      const created = await service.createManualLead(dataScope, {
        businessName: "Transferred Alert Customer",
        phone: "9123456794",
        source: "MANUAL",
        assignedToId: "staff-a",
      });

      expect(created.outcome).toBe("created");

      if (created.outcome === "created") {
        await service.transferLead(dataScope, created.lead.id, {
          toUserId: "staff-b",
          reason: "Senior staff should handle this follow-up.",
        }, "staff-a");

        const alerts = await service.listDueFollowUpAlerts(dataScope, "staff-b");
        expect(alerts).toHaveLength(1);
        expect(alerts[0]).toMatchObject({
          customerName: "Transferred Alert Customer",
          reason: "TRANSFERRED_LEAD",
          isTransfer: true,
        });
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("requires scheduled site visit outcome on the next spoken follow-up", async () => {
    const repository = new InMemoryLeadRepository();
    const service = new LeadIntakeService(repository);
    const created = await service.createManualLead(dataScope, {
      businessName: "Site Visit Customer",
      phone: "9123456787",
      source: "MANUAL",
    });

    expect(created.outcome).toBe("created");

    if (created.outcome === "created") {
      await service.saveCallOutcome(dataScope, created.lead.id, {
        callOutcome: "SPOKE",
        leadIntent: "INSTALLATION",
        conversationSummary: "Customer asked for site visit.",
        followUpReason: "SITE_VISIT",
        siteVisitStatus: "SCHEDULED",
        siteVisitScheduledAt: "2026-06-02T06:00:00.000Z",
      });

      await expect(
        service.saveCallOutcome(dataScope, created.lead.id, {
          callOutcome: "SPOKE",
          leadIntent: "INSTALLATION",
          conversationSummary: "Customer answered after scheduled site visit.",
          followUpReason: "NURTURE",
          followUpAt: "2026-06-03T06:00:00.000Z",
        }),
      ).rejects.toThrow("Site visit status is required");

      const updated = await service.saveCallOutcome(dataScope, created.lead.id, {
        callOutcome: "SPOKE",
        leadIntent: "INSTALLATION",
        conversationSummary: "Customer answered after scheduled site visit.",
        siteVisitOutcome: {
          status: "COMPLETED",
          outcomeSummary: "Shop needs 4 cameras and cable routing.",
        },
        followUpReason: "NURTURE",
        followUpAt: "2026-06-03T06:00:00.000Z",
      });

      expect(updated.timeline.at(-1)?.summary).toContain("Site visit completed");
    }
  });

  it("moves a follow-up to Lost Leads only with lost summary", async () => {
    const repository = new InMemoryLeadRepository();
    const service = new LeadIntakeService(repository);
    const created = await service.createManualLead(dataScope, {
      businessName: "Lost Customer",
      phone: "9123456788",
      source: "MANUAL",
    });

    expect(created.outcome).toBe("created");

    if (created.outcome === "created") {
      await service.saveCallOutcome(dataScope, created.lead.id, {
        callOutcome: "SPOKE",
        leadIntent: "WARM",
        conversationSummary: "Customer asked to call later.",
      });

      await expect(
        service.saveCallOutcome(dataScope, created.lead.id, {
          callOutcome: "SPOKE",
          leadIntent: "LOST",
          conversationSummary: "Customer selected another provider.",
        }),
      ).rejects.toThrow("Lost summary is required");

      const lost = await service.saveCallOutcome(dataScope, created.lead.id, {
        callOutcome: "SPOKE",
        leadIntent: "LOST",
        conversationSummary: "Customer selected another provider.",
        lostSummary: "Customer chose lower price from competitor.",
      });

      expect(lost.currentStage).toBe("LOST");
      expect(await service.listLeadsByQueue(dataScope, "LOST")).toHaveLength(1);
    }
  });
});
