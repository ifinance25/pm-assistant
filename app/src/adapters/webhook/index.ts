import type { Db } from "../../db/index.ts";
import type { Meeting, WebhookDeliveryStatus } from "../../shared/types.ts";
import { fetchWithTimeout } from "../../shared/http-timeout.ts";

export const WEBHOOK_NOT_CONFIGURED = "вебхук не настроен";

export type WebhookDeliveryResult = {
  status: WebhookDeliveryStatus;
  detail: string;
};

export type ReadyWebhookPayload = {
  event: "meeting.ready";
  meeting: Meeting;
};

export async function deliverReadyWebhook(
  db: Db,
  meeting: Meeting,
  opts?: { fetchImpl?: typeof fetch; url?: string },
): Promise<WebhookDeliveryResult> {
  const url = (opts?.url ?? db.getSettings().webhookUrl).trim();
  if (!url) {
    const result: WebhookDeliveryResult = {
      status: "skipped",
      detail: WEBHOOK_NOT_CONFIGURED,
    };
    db.recordWebhookDelivery({
      meetingId: meeting.id,
      url: "",
      status: result.status,
      detail: result.detail,
    });
    return result;
  }

  const fetchImpl = opts?.fetchImpl ?? fetchWithTimeout;
  const payload: ReadyWebhookPayload = {
    event: "meeting.ready",
    meeting,
  };
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result: WebhookDeliveryResult = response.ok
      ? { status: "delivered", detail: `HTTP ${response.status}` }
      : { status: "failed", detail: `HTTP ${response.status}` };
    db.recordWebhookDelivery({
      meetingId: meeting.id,
      url,
      status: result.status,
      detail: result.detail,
    });
    return result;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const result: WebhookDeliveryResult = { status: "failed", detail };
    db.recordWebhookDelivery({
      meetingId: meeting.id,
      url,
      status: result.status,
      detail,
    });
    return result;
  }
}
