import { z } from "zod";
import * as XLSX from "xlsx";
import { getSessionCookieName, getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, adminWriteProcedure, primaryAdminProcedure, primaryAdminWriteProcedure, publicProcedure, router } from "./_core/trpc";
import {
  SlotTakenError,
  cancelInvitation,
  createInvitation,
  createAdminAccount,
  deleteAdminAccount,
  createPrivacyRequest,
  resetAdminPassword,
  updateAdminAccount,
  createSlots,
  dashboard,
  decideRequest,
  exportInvitationRows,
  listAdmins,
  listAudit,
  formOptions,
  listCalendar,
  listDepartments,
  listInterventionTypes,
  saveInterventionType,
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
  interventionTypeId: z.number().int().positive(),
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
    submitRequest: publicProcedure.input(invitationInput).mutation(async ({ input, ctx }) => {
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
    dashboard: adminProcedure.query(({ ctx }) => dashboard(ctx.adminScope)),
    requests: adminProcedure
      .input(z.object({ departmentId: z.number().int().positive().optional(), status: z.array(requestStatus).optional(), search: z.string().max(120).optional(), federation: z.string().max(80).optional(), month: z.string().regex(/^\d{4}-\d{2}$/).optional(), year: z.string().regex(/^\d{4}$/).optional() }).optional())
      .query(({ input, ctx }) => listRequests(input ?? {}, ctx.adminScope)),
    calendar: adminProcedure
      .input(z.object({ departmentId: z.number().int().positive().optional(), month: z.string().regex(/^\d{4}-\d{2}$/).optional(), status: slotStatus.optional(), federation: z.string().max(80).optional() }).optional())
      .query(({ input, ctx }) => listCalendar(input, ctx.adminScope)),
    formOptions: adminProcedure.query(() => formOptions()),
    departments: adminProcedure
      .query(({ ctx }) => listDepartments(ctx.adminScope)),
    interventionTypes: adminProcedure
      .input(
        z.object({
          departmentId: z.number().int().positive().optional(),
          includeInactive: z.boolean().optional(),
        }).optional(),
      )
      .query(({ input, ctx }) =>
        listInterventionTypes(input?.departmentId, ctx.adminScope, input?.includeInactive)
      ),
    saveInterventionType: adminWriteProcedure
      .input(z.object({ id: z.number().int().positive().optional(), departmentId: z.number().int().positive(), name: z.string().trim().min(1).max(80), active: z.enum(["YES", "NO"]) }))
      .mutation(({ input, ctx }) => saveInterventionType(input, ctx.user.email ?? ctx.user.openId, ctx.adminScope)),
    createSlots: adminWriteProcedure
      .input(z.object({
        dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(366),
        departmentId: z.number().int().positive(),
        federation: z.string().trim().min(2).max(80),
        status: z.enum(["AVAILABLE", "UNAVAILABLE"]).optional(),
      }))
      .mutation(({ input, ctx }) => createSlots(
        input.dates,
        input.departmentId,
        input.federation,
        ctx.user.email ?? ctx.user.openId,
        ctx.adminScope,
        input.status ?? "AVAILABLE",
      )),
    updateSlot: adminWriteProcedure
      .input(z.object({ slotId: z.number().int().positive(), status: slotStatus, note: z.string().max(1000).optional() }))
      .mutation(({ input, ctx }) => setSlotStatus(input.slotId, input.status, ctx.user.email ?? ctx.user.openId, ctx.adminScope, input.note)),
    updateSlotFederation: adminWriteProcedure
      .input(z.object({
        slotId: z.number().int().positive(),
        federation: z.string().trim().min(2).max(80),
      }))
      .mutation(({ input, ctx }) => setSlotFederation(
        input.slotId,
        input.federation,
        ctx.user.email ?? ctx.user.openId,
        ctx.adminScope,
      )),
    removeSlot: adminWriteProcedure
      .input(z.object({ slotId: z.number().int().positive() }))
      .mutation(({ input, ctx }) => removeEmptySlot(input.slotId, ctx.user.email ?? ctx.user.openId, ctx.adminScope)),
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
      .mutation(({ input, ctx }) => updateInvitationDetails({
        ...input,
        actor: ctx.user.email ?? ctx.user.openId,
        scope: ctx.adminScope,
      })),
    decide: adminWriteProcedure
      .input(z.object({ requestId: z.number().int().positive(), action: z.enum(["CONFIRM", "RELEASE"]), note: z.string().max(1000).optional() }))
      .mutation(({ input, ctx }) => decideRequest({
        ...input,
        actor: ctx.user.email ?? ctx.user.openId,
        scope: ctx.adminScope,
      })),
    cancel: adminWriteProcedure
      .input(z.object({ requestId: z.number().int().positive(), disposition: z.enum(["AVAILABLE", "UNAVAILABLE"]), note: z.string().max(1000).optional() }))
      .mutation(({ input, ctx }) => cancelInvitation({
        ...input,
        actor: ctx.user.email ?? ctx.user.openId,
        scope: ctx.adminScope,
      })),
    reschedule: adminWriteProcedure
      .input(z.object({ requestId: z.number().int().positive(), newSlotId: z.number().int().positive(), oldDisposition: z.enum(["AVAILABLE", "UNAVAILABLE"]) }))
      .mutation(({ input, ctx }) => rescheduleInvitation({
        ...input,
        actor: ctx.user.email ?? ctx.user.openId,
        scope: ctx.adminScope,
      })),
    settings: primaryAdminProcedure.query(() => settings()),
    schedulerStatus: primaryAdminProcedure.query(() => scheduledWorkStatus()),
    updateSetting: primaryAdminWriteProcedure
      .input(z.object({ key: z.enum(["federations", "fields", "reminders", "retention", "emailTemplates"]), value: z.unknown() }))
      .mutation(({ input, ctx }) => updateSetting(input.key, input.value, ctx.user.email ?? ctx.user.openId)),
    audit: primaryAdminProcedure.input(z.object({ limit: z.number().int().min(1).max(250).optional() }).optional()).query(({ input }) => listAudit(input?.limit)),
    admins: primaryAdminProcedure.query(() => listAdmins()),
    createAdmin: primaryAdminWriteProcedure
      .input(z.object({
        name: z.string().trim().min(1).max(180),
        email: z.string().trim().email().max(320),
        password: z.string().min(12).max(200),
        role: z.enum(["PRIMARY_ADMIN", "ADMIN", "READ_ONLY"]),
        departmentIds: z.array(z.number().int().positive()),
      }))
      .mutation(({ input, ctx }) =>
        createAdminAccount({
          ...input,
          actor: ctx.user.email ?? ctx.user.openId,
        }),
      ),

    updateAdmin: primaryAdminWriteProcedure
      .input(z.object({
        adminProfileId: z.number().int().positive(),
        name: z.string().trim().min(1).max(180),
        email: z.string().trim().email().max(320),
        role: z.enum(["PRIMARY_ADMIN", "ADMIN", "READ_ONLY"]),
        active: z.enum(["YES", "NO"]),
        departmentIds: z.array(z.number().int().positive()),
      }))
      .mutation(({ input, ctx }) =>
        updateAdminAccount({
          ...input,
          actor: ctx.user.email ?? ctx.user.openId,
        }),
      ),

    deleteAdmin: primaryAdminWriteProcedure
      .input(z.object({ adminProfileId: z.number().int().positive() }))
      .mutation(({ input, ctx }) => deleteAdminAccount({
        ...input,
        actorUserId: ctx.user.id,
        actor: ctx.user.email ?? ctx.user.openId,
      })),

    resetAdminPassword: primaryAdminWriteProcedure
      .input(z.object({
        adminProfileId: z.number().int().positive(),
        newPassword: z.string().min(12).max(200),
      }))
      .mutation(({ input, ctx }) =>
        resetAdminPassword({
          ...input,
          actor: ctx.user.email ?? ctx.user.openId,
        }),
      ),
    privacyRequests: primaryAdminProcedure.query(() => listPrivacyRequests()),
    privacyDetails: primaryAdminProcedure.input(z.object({ requestId: z.number().int().positive() })).query(({ input }) => privacyRequestDetails(input.requestId)),
    privacyStatus: primaryAdminWriteProcedure.input(z.object({ requestId: z.number().int().positive(), status: z.enum(["NEW", "IN_PROGRESS"]) }))
      .mutation(({ input, ctx }) => setPrivacyRequestStatus({ ...input, actor: ctx.user.email ?? ctx.user.openId })),
    privacyComplete: primaryAdminWriteProcedure.input(z.object({ requestId: z.number().int().positive() }))
      .mutation(({ input, ctx }) => completePrivacyRequest(input.requestId, ctx.user.email ?? ctx.user.openId)),
    runRetention: primaryAdminWriteProcedure.mutation(({ ctx }) => anonymizeExpiredRequests(ctx.user.email ?? ctx.user.openId)),
    gmailMailStatus: primaryAdminProcedure.query(() => gmailConnectionStatus()),
    emailOutbox: primaryAdminProcedure.query(() => listEmailOutbox(40)),
    retryEmail: primaryAdminWriteProcedure.input(z.object({ id: z.number().int().positive() })).mutation(({ input }) => retryEmailOutbox(input.id)),
    export: adminProcedure
      .input(z.object({ departmentId: z.number().int().positive().optional(), format: z.enum(["csv", "xlsx"]), status: z.array(requestStatus).optional(), federation: z.string().max(80).optional(), month: z.string().regex(/^\d{4}-\d{2}$/).optional(), year: z.string().regex(/^\d{4}$/).optional(), search: z.string().max(120).optional() }))
      .query(async ({ input, ctx }) => {
        const rows = await exportInvitationRows(input, ctx.adminScope);
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
