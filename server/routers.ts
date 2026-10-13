import { z } from "zod";
import * as XLSX from "xlsx";
import { getSessionCookieName, getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, adminWriteProcedure, publicProcedure, router } from "./_core/trpc";
import {
  SlotTakenError,
  cancelInvitation,
  createInvitation,
  createPrivacyRequest,
  createSlots,
  dashboard,
  decideRequest,
  exportInvitationRows,
  listAdmins,
  listAudit,
  listCalendar,
  listDepartments,
  listInterventionTypes,
  listPublicBootstrap,
  listRequests,
  removeEmptySlot,
  rescheduleInvitation,
  setSlotFederation,
  setSlotStatus,
  settings,
  scheduledWorkStatus,
  updateInvitationDetails,
  updateSetting,
} from "./services/gcv";
import {
  anonymizeExpiredRequests,
  completePrivacyRequest,
  listPrivacyRequests,
  privacyRequestDetails,
  setPrivacyRequestStatus,
} from "./services/privacy";
import { gmailConnectionStatus } from "./services/gmail-smtp";
import { listEmailOutbox, retryEmailOutbox } from "./services/email";

const slotStatus = z.enum(["AVAILABLE", "PENDING_CONFIRMATION", "CONFIRMED", "UNAVAILABLE"]);
const requestStatus = z.enum(["PENDING", "CONFIRMED", "REFUSED", "CANCELLED", "RESCHEDULED"]);
const invitationInput = z.object({
  dateSlotId: z.number().int().positive(),
  federation: z.string().trim().min(2).max(80),
  church: z.string().trim().min(2).max(180),
  contactName: z.string().trim().min(2).max(180),
  email: z.string().trim().email().max(320),
  phone: z.string().trim().min(5).max(80),
  interventionType: z.string().trim().max(80).optional().nullable(),
  message: z.string().max(3000).optional().nullable(),
  desiredTime: z.string().max(40).optional().nullable(),
  churchAddress: z.string().max(500).optional().nullable(),
  consent: z.literal(true),
});

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(getSessionCookieName(ctx.req), { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  public: router({
    bootstrap: publicProcedure.query(() => listPublicBootstrap()),
    submitRequest: publicProcedure.input(invitationInput).mutation(async ({ input }) => {
      try {
        return await createInvitation(input);
      } catch (error) {
        if (error instanceof SlotTakenError) throw new Error(error.message);
        throw error;
      }
    }),
    privacyRequest: publicProcedure
      .input(z.object({ email: z.string().email(), requestType: z.enum(["ACCESS", "DELETE"]), message: z.string().max(2000).optional() }))
      .mutation(({ input }) => createPrivacyRequest(input)),
  }),
  admin: router({
    dashboard: adminProcedure.query(() => dashboard()),
    requests: adminProcedure
      .input(z.object({ status: z.array(requestStatus).optional(), search: z.string().max(120).optional(), federation: z.string().max(80).optional(), month: z.string().regex(/^\d{4}-\d{2}$/).optional(), year: z.string().regex(/^\d{4}$/).optional() }).optional())
      .query(({ input }) => listRequests(input ?? {})),
    calendar: adminProcedure
      .input(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional(), status: slotStatus.optional(), federation: z.string().max(80).optional() }).optional())
      .query(({ input }) => listCalendar(input)),
    departments: adminProcedure
      .query(() => listDepartments()),
    interventionTypes: adminProcedure
      .input(
        z.object({
          departmentId: z.number().int().positive().optional(),
        }).optional(),
      )
      .query(({ input }) => listInterventionTypes(input?.departmentId)),
    createSlots: adminWriteProcedure
      .input(z.object({
        dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(366),
        departmentId: z.number().int().positive(),
        interventionTypeId: z.number().int().positive().nullable().optional(),
        federation: z.string().trim().min(2).max(80),
        status: z.enum(["AVAILABLE", "UNAVAILABLE"]).optional(),
      }))
      .mutation(({ input, ctx }) => createSlots(
        input.dates,
        input.departmentId,
        input.federation,
        ctx.user.email ?? ctx.user.openId,
        input.status ?? "AVAILABLE",
        input.interventionTypeId,
      )),
    updateSlot: adminWriteProcedure
      .input(z.object({ slotId: z.number().int().positive(), status: slotStatus, note: z.string().max(1000).optional() }))
      .mutation(({ input, ctx }) => setSlotStatus(input.slotId, input.status, ctx.user.email ?? ctx.user.openId, input.note)),
    updateSlotFederation: adminWriteProcedure
      .input(z.object({
        slotId: z.number().int().positive(),
        federation: z.string().trim().min(2).max(80),
      }))
      .mutation(({ input, ctx }) => setSlotFederation(
        input.slotId,
        input.federation,
        ctx.user.email ?? ctx.user.openId,
      )),
    removeSlot: adminWriteProcedure
      .input(z.object({ slotId: z.number().int().positive() }))
      .mutation(({ input, ctx }) => removeEmptySlot(input.slotId, ctx.user.email ?? ctx.user.openId)),
    updateInvitation: adminWriteProcedure
      .input(z.object({
        requestId: z.number().int().positive(),
        federation: z.string().trim().min(2).max(80),
        church: z.string().trim().min(2).max(180),
        contactName: z.string().trim().min(2).max(180),
        email: z.string().trim().email().max(320),
        phone: z.string().trim().min(5).max(80),
        interventionType: z.string().trim().max(80),
        message: z.string().max(3000).optional().nullable(),
        desiredTime: z.string().max(40).optional().nullable(),
        churchAddress: z.string().max(500).optional().nullable(),
      }))
      .mutation(({ input, ctx }) => updateInvitationDetails({ ...input, actor: ctx.user.email ?? ctx.user.openId })),
    decide: adminWriteProcedure
      .input(z.object({ requestId: z.number().int().positive(), action: z.enum(["CONFIRM", "RELEASE"]), note: z.string().max(1000).optional() }))
      .mutation(({ input, ctx }) => decideRequest({ ...input, actor: ctx.user.email ?? ctx.user.openId })),
    cancel: adminWriteProcedure
      .input(z.object({ requestId: z.number().int().positive(), disposition: z.enum(["AVAILABLE", "UNAVAILABLE"]), note: z.string().max(1000).optional() }))
      .mutation(({ input, ctx }) => cancelInvitation({ ...input, actor: ctx.user.email ?? ctx.user.openId })),
    reschedule: adminWriteProcedure
      .input(z.object({ requestId: z.number().int().positive(), newSlotId: z.number().int().positive(), oldDisposition: z.enum(["AVAILABLE", "UNAVAILABLE"]) }))
      .mutation(({ input, ctx }) => rescheduleInvitation({ ...input, actor: ctx.user.email ?? ctx.user.openId })),
    settings: adminProcedure.query(() => settings()),
    schedulerStatus: adminProcedure.query(() => scheduledWorkStatus()),
    updateSetting: adminWriteProcedure
      .input(z.object({ key: z.enum(["federations", "fields", "reminders", "retention", "emailTemplates"]), value: z.unknown() }))
      .mutation(({ input, ctx }) => updateSetting(input.key, input.value, ctx.user.email ?? ctx.user.openId)),
    audit: adminProcedure.input(z.object({ limit: z.number().int().min(1).max(250).optional() }).optional()).query(({ input }) => listAudit(input?.limit)),
    admins: adminProcedure.query(() => listAdmins()),
    privacyRequests: adminProcedure.query(() => listPrivacyRequests()),
    privacyDetails: adminProcedure.input(z.object({ requestId: z.number().int().positive() })).query(({ input }) => privacyRequestDetails(input.requestId)),
    privacyStatus: adminWriteProcedure.input(z.object({ requestId: z.number().int().positive(), status: z.enum(["NEW", "IN_PROGRESS"]) }))
      .mutation(({ input, ctx }) => setPrivacyRequestStatus({ ...input, actor: ctx.user.email ?? ctx.user.openId })),
    privacyComplete: adminWriteProcedure.input(z.object({ requestId: z.number().int().positive() }))
      .mutation(({ input, ctx }) => completePrivacyRequest(input.requestId, ctx.user.email ?? ctx.user.openId)),
    runRetention: adminWriteProcedure.mutation(({ ctx }) => anonymizeExpiredRequests(ctx.user.email ?? ctx.user.openId)),
    gmailMailStatus: adminProcedure.query(() => gmailConnectionStatus()),
    emailOutbox: adminProcedure.query(() => listEmailOutbox(40)),
    retryEmail: adminWriteProcedure.input(z.object({ id: z.number().int().positive() })).mutation(({ input }) => retryEmailOutbox(input.id)),
    export: adminProcedure
      .input(z.object({ format: z.enum(["csv", "xlsx"]), status: z.array(requestStatus).optional(), federation: z.string().max(80).optional(), month: z.string().regex(/^\d{4}-\d{2}$/).optional(), year: z.string().regex(/^\d{4}$/).optional(), search: z.string().max(120).optional() }))
      .query(async ({ input }) => {
        const rows = await exportInvitationRows(input);
        if (input.format === "csv") {
          const sheet = XLSX.utils.json_to_sheet(rows);
          const csv = XLSX.utils.sheet_to_csv(sheet, { FS: ";" });
          return { filename: "gcv-ufb-export.csv", mime: "text/csv;charset=utf-8", contentBase64: Buffer.from("\uFEFF" + csv).toString("base64") };
        }
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Invitations");
        const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
        return { filename: "gcv-ufb-export.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", contentBase64: Buffer.from(bytes).toString("base64") };
      }),
  }),
});

export type AppRouter = typeof appRouter;
