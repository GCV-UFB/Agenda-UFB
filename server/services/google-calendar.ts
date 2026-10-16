import { google } from "googleapis";
import { getGoogleRefreshToken } from "./google-mail-token";

const CALENDAR_TIME_ZONE = "Europe/Paris";

function googleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const calendarId = process.env.GOOGLE_CALENDAR_ID?.trim();

  if (!clientId || !clientSecret || !calendarId) {
    throw new Error(
      "Google Calendar não configurado. Verifique GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e GOOGLE_CALENDAR_ID.",
    );
  }

  return { clientId, clientSecret, calendarId };
}

async function calendarClient() {
  const config = googleConfig();
  const refreshToken = await getGoogleRefreshToken();

  if (!refreshToken) {
    throw new Error(
      "Conta Google ainda não autorizada. Autorize novamente o Google com acesso ao Calendar.",
    );
  }

  const auth = new google.auth.OAuth2(config.clientId, config.clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });

  return {
    calendar: google.calendar({ version: "v3", auth }),
    calendarId: config.calendarId,
  };
}

export type GcvCalendarInvitation = {
  departmentName?: string;
  submissionId: string;
  date: string;
  federation: string;
  church: string;
  contactName: string;
  email: string;
  phone: string;
  interventionType?: string | null;
  desiredTime?: string | null;
  churchAddress?: string | null;
  message?: string | null;
};

function nextIsoDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));

  return [
    next.getUTCFullYear(),
    String(next.getUTCMonth() + 1).padStart(2, "0"),
    String(next.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function eventResource(input: GcvCalendarInvitation) {
  const description = [
    `Département : ${input.departmentName || "UFB"}`,
    `Fédération : ${input.federation}`,
    `Église : ${input.church}`,
    `Type d'intervention : ${input.interventionType || "—"}`,
    `Heure souhaitée : ${input.desiredTime || "—"}`,
    `Contact : ${input.contactName}`,
    `Téléphone : ${input.phone}`,
    `E-mail : ${input.email}`,
    `Identifiant : ${input.submissionId}`,
    input.message ? `Informations complémentaires : ${input.message}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    summary: `${input.departmentName || "Intervention UFB"} — ${input.church}`,
    description,
    location: input.churchAddress || undefined,
    start: {
      date: input.date,
      timeZone: CALENDAR_TIME_ZONE,
    },
    end: {
      date: nextIsoDate(input.date),
      timeZone: CALENDAR_TIME_ZONE,
    },
  };
}

export async function createGcvCalendarEvent(
  input: GcvCalendarInvitation,
): Promise<string> {
  const { calendar, calendarId } = await calendarClient();

  const response = await calendar.events.insert({
    calendarId,
    requestBody: eventResource(input),
  });

  const eventId = response.data.id;

  if (!eventId) {
    throw new Error("Google Calendar não retornou o identificador do evento.");
  }

  return eventId;
}

export async function updateGcvCalendarEvent(
  eventId: string,
  input: GcvCalendarInvitation,
) {
  const { calendar, calendarId } = await calendarClient();

  await calendar.events.update({
    calendarId,
    eventId,
    requestBody: eventResource(input),
  });
}

export async function deleteGcvCalendarEvent(eventId: string) {
  const { calendar, calendarId } = await calendarClient();

  try {
    await calendar.events.delete({
      calendarId,
      eventId,
    });
  } catch (error: any) {
    if (error?.code === 404 || error?.response?.status === 404) {
      return;
    }

    throw error;
  }
}
