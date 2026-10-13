import type { Express, Request, Response } from "express";
import { decideFromActionToken } from "../services/gcv";

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function page(title: string, message: string, tone: "success" | "warning" | "error") {
  const colors = tone === "success" ? ["#E4F6EA", "#176B43"] : tone === "warning" ? ["#FFF0D4", "#945B06"] : ["#FCE6E6", "#8A2D2D"];
  const base = (process.env.PUBLIC_APP_URL || "").replace(/\/$/, "");
  const dashboard = `${base}/admin` || "/admin";
  return `<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} — GCV-UFB</title></head><body style="margin:0;background:#f4f7fa;font-family:Arial,sans-serif;color:#17324b"><main style="max-width:560px;margin:10vh auto;padding:24px"><section style="background:#fff;border-radius:18px;padding:32px;box-shadow:0 10px 30px #123a5a18"><div style="display:inline-block;padding:7px 10px;border-radius:99px;background:${colors[0]};color:${colors[1]};font-weight:700">GCV-UFB</div><h1 style="margin:20px 0 10px">${escapeHtml(title)}</h1><p style="line-height:1.6">${escapeHtml(message)}</p><a href="${escapeHtml(dashboard)}" style="display:inline-block;margin-top:20px;padding:13px 18px;background:#176b9b;border-radius:8px;color:white;text-decoration:none;font-weight:700">Retour au tableau de bord</a></section></main></body></html>`;
}

function emailFeedback(status: string) {
  if (status === "SENT") return "Un e-mail a bien été accepté par le service de messagerie.";
  if (status === "SENDING") return "La décision est enregistrée et l’e-mail est en cours d’envoi.";
  if (status === "FAILED") return "La décision est enregistrée, mais l’e-mail n’a pas pu être envoyé. Veuillez vérifier la configuration Gmail API et le journal des e-mails.";
  return "La décision est enregistrée, mais aucun e-mail n’a été envoyé : le service Gmail API doit être configuré pour activer l’envoi.";
}

export function registerActionRoutes(app: Express) {
  app.get("/api/actions/:token", async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    try {
      const outcome = await decideFromActionToken(req.params.token);
      if (!outcome) {
        res.status(410).send(page("Lien non disponible", "Cette action a déjà été traitée, a expiré ou n’est plus applicable.", "warning"));
        return;
      }
      const { data } = outcome;
      const title = outcome.confirmed ? "Invitation confirmée" : "Date libérée";
      const baseMessage = outcome.confirmed
        ? `L’invitation du ${data.slot.date} pour ${data.request.church} a été confirmée avec succès.`
        : `La demande du ${data.slot.date} pour ${data.request.church} n’a pas été confirmée. La date est de nouveau disponible dans l’agenda.`;
      res.status(200).send(page(title, `${baseMessage} ${emailFeedback(outcome.emailStatus)}`, outcome.confirmed ? "success" : "warning"));
    } catch {
      res.status(500).send(page("Action indisponible", "Une erreur est survenue. Veuillez retourner au tableau de bord et vérifier la demande.", "error"));
    }
  });
}
