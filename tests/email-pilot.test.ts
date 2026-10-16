import { afterEach, describe, expect, it } from "vitest";
import { emailNotificationsEnabled } from "../server/services/email";

const originalValue = process.env.UFB_EMAIL_NOTIFICATIONS_ENABLED;

afterEach(() => {
  if (originalValue === undefined) {
    delete process.env.UFB_EMAIL_NOTIFICATIONS_ENABLED;
  } else {
    process.env.UFB_EMAIL_NOTIFICATIONS_ENABLED = originalValue;
  }
});

describe("Agenda UFB - pilot email protection", () => {
  it("disables notifications when the variable is absent", () => {
    delete process.env.UFB_EMAIL_NOTIFICATIONS_ENABLED;
    expect(emailNotificationsEnabled()).toBe(false);
  });

  it("disables notifications when explicitly set to false", () => {
    process.env.UFB_EMAIL_NOTIFICATIONS_ENABLED = "false";
    expect(emailNotificationsEnabled()).toBe(false);
  });

  it("enables notifications only when explicitly set to true", () => {
    process.env.UFB_EMAIL_NOTIFICATIONS_ENABLED = "true";
    expect(emailNotificationsEnabled()).toBe(true);
  });
});

describe("Agenda UFB - email delivery protection", () => {
  it("does not process the outbox when notifications are disabled", async () => {
    const { deliverOutbox } = await import("../server/services/email");

    process.env.UFB_EMAIL_NOTIFICATIONS_ENABLED = "false";

    const result = await deliverOutbox();

    expect(result).toEqual({
      delivered: 0,
      preview: 0,
    });
  });
});
