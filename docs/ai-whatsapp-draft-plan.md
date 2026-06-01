# CI4U AI WhatsApp Draft Plan

## Decision

Do not put AI directly inside the browser or lead-save path yet.

The professional approach is:

1. Staff enters conversation summary.
2. Backend validates the lead workflow.
3. Backend optionally calls an AI draft service.
4. AI returns structured JSON only.
5. Staff previews/edits the WhatsApp message.
6. Staff manually opens WhatsApp and sends.
7. The final message body and action are saved to history.

## Official Research Notes

- OpenAI recommends the Responses API for new text-generation work.
- Structured Outputs should be used when the app needs predictable JSON fields instead of free text.
- API keys must stay server-side in environment variables or secret management.
- Development and production should use separate projects to isolate usage, rate limits, spend, and data.
- Production AI features need testing, privacy review, and safety controls.

Official sources checked:

- https://platform.openai.com/docs/guides/text
- https://platform.openai.com/docs/guides/structured-outputs
- https://platform.openai.com/docs/api-reference/responses/create
- https://platform.openai.com/docs/guides/production-best-practices
- https://platform.openai.com/docs/guides/latest-model

## Recommended AI Use

Start with a small backend-only AI feature:

`POST /v1/ai/whatsapp-draft`

Input:

- customerName
- phoneNormalized
- currentStage
- leadIntent
- followUpReason
- conversationSummary
- siteVisitStatus
- staffName

Output JSON:

- messageBody
- tone
- nextActionLabel
- riskFlags
- confidence

Model choice:

- Start with a small/cost-efficient model for WhatsApp drafting because this is a narrow text-generation task.
- Use a stronger model only if message quality or multilingual handling is poor.
- Recheck model availability and pricing before production.

## Safety Rules

- Never expose the OpenAI API key in frontend code.
- Do not send unnecessary customer history to AI.
- Do not send KYC documents, Aadhaar, signatures, vendor prices, or margins.
- Save AI input/output for audit when enabled.
- Mark message as AI-generated until staff edits or confirms it.
- Manual send stays in version 1.

## Current Implementation Status

The app currently uses a deterministic WhatsApp draft generator in the frontend.

This is intentional:

- zero API cost,
- no customer data sent outside the app,
- fast enough for workflow testing,
- easy to replace later with backend AI draft service.
