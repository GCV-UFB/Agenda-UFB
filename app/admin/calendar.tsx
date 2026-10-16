import { InterventionTypeManager } from "@/components/intervention-type-manager";
import { useMemo, useState } from "react";
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { groupSlotsByDate } from "@/shared/calendar";
import { useRouter } from "expo-router";
import { useAuth } from "@/hooks/use-auth";
import { EmptyState, Field, GCV, LoadingBlock, PrimaryButton, SectionCard, StatusPill } from "@/components/gcv-ui";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import { FEDERATIONS, STATUS_META, toFrenchDate, type SlotStatus } from "@/shared/gcv";

const currentDate = new Date();
const currentMonth = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, "0")}`;
const weekdays = ["L", "M", "M", "J", "V", "S", "D"];
type RangeMode = "saturdays" | "weekends";
function calendarDates<T extends { slot: { date: string } }>(month: string, entries: T[]) {
  const first = new Date(`${month}-01T12:00:00`);
  const offset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const byDate = groupSlotsByDate(entries);
  return [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => {
      const key = `${month}-${String(index + 1).padStart(2, "0")}`;
      return { date: key, day: index + 1, entries: byDate.get(key) ?? [] };
    }),
  ];
}
function frenchDateToIso(value: string) {
  const parts = value.trim().split("/");
  if (
    parts.length !== 3 ||
    !/^\d{2}$/.test(parts[0]) ||
    !/^\d{2}$/.test(parts[1]) ||
    !/^\d{4}$/.test(parts[2])
  ) return null;

  const [day, month, year] = parts;
  const iso = `${year}-${month}-${day}`;
  const date = new Date(`${iso}T12:00:00`);

  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== Number(year) ||
    date.getMonth() + 1 !== Number(month) ||
    date.getDate() !== Number(day)
  ) return null;

  return iso;
}

function makeDates(start: string, end: string, mode: RangeMode) {
  if (start > end) return [];
  const out: string[] = [];
  const cursor = new Date(`${start}T12:00:00`);
  const last = new Date(`${end}T12:00:00`);
  while (cursor <= last) {
    const day = cursor.getDay();
    if (mode === "weekends" ? day === 6 || day === 0 : day === 6) out.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`);
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export default function CalendarScreen() {
  const router = useRouter();
  const auth = useAuth();
  const canWrite =
    auth.user?.adminRole === "PRIMARY_ADMIN" ||
    auth.user?.adminRole === "ADMIN";
  const [month, setMonth] = useState(currentMonth);
  const [targetMonth, setTargetMonth] = useState("");
  const [status, setStatus] = useState<SlotStatus | "ALL">("ALL");
  const [departmentId, setDepartmentId] = useState<number | undefined>();
  const [federation, setFederation] = useState("");
  const [creationFederation, setCreationFederation] = useState("");
  const [creationDepartmentId, setCreationDepartmentId] = useState<number | null>(null);
  const [manual, setManual] = useState("");
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [rangeMode, setRangeMode] = useState<RangeMode>("saturdays");
  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(null);
  const utils = trpc.useUtils();
  const settings = trpc.admin.formOptions.useQuery();
  const departments = trpc.admin.departments.useQuery();
  const configuredFederations = settings.data?.federations as string[] | undefined;
  const federations = configuredFederations?.length ? configuredFederations : [...FEDERATIONS];
  const calendar = trpc.admin.calendar.useQuery({ month, departmentId, status: status === "ALL" ? undefined : status, federation: federation || undefined });
  const printableCalendar = trpc.admin.calendar.useQuery({ departmentId, federation: federation || undefined });
  const create = trpc.admin.createSlots.useMutation({ onSuccess: async () => { await utils.admin.calendar.invalidate(); setManual(""); } });
  const update = trpc.admin.updateSlot.useMutation({ onSuccess: () => { void utils.admin.calendar.invalidate(); void utils.admin.dashboard.invalidate(); } });
  const updateFederation = trpc.admin.updateSlotFederation.useMutation({
    onSuccess: async () => {
      await utils.admin.calendar.invalidate();
      void utils.admin.dashboard.invalidate();
    },
  });
  const remove = trpc.admin.removeSlot.useMutation({ onSuccess: async () => { setSelectedSlotId(null); await utils.admin.calendar.invalidate(); void utils.admin.dashboard.invalidate(); } });
  const entries = useMemo(() => calendar.data ?? [], [calendar.data]);
  const days = useMemo(() => calendarDates(month, entries), [month, entries]);
  const selected = entries.find(({ slot }) => slot.id === selectedSlotId);
  const add = (dates: string[]) => {
    if (dates.length && creationDepartmentId && creationFederation) {
      create.mutate({
        dates,
        departmentId: creationDepartmentId,
        federation: creationFederation,
      });
    }
  };
  const manualIso = frenchDateToIso(manual);
  const rangeStartIso = frenchDateToIso(rangeStart);
  const rangeEndIso = frenchDateToIso(rangeEnd);
  const confirm = (title: string, message: string, action: () => void, destructive = false) => {
    if (Platform.OS === "web") { if (window.confirm(`${title}\n\n${message}`)) action(); return; }
    Alert.alert(title, message, [{ text: "Annuler", style: "cancel" }, { text: "Confirmer", style: destructive ? "destructive" : "default", onPress: action }]);
  };
  const shiftMonth = (amount: number) => { const date = new Date(`${month}-01T12:00:00`); date.setMonth(date.getMonth() + amount); setMonth(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`); setSelectedSlotId(null); };

  const printAgenda = () => {
    if (Platform.OS !== "web") {
      Alert.alert("Impression disponible sur le Web", "Ouvrez l’espace administrateur dans votre navigateur pour imprimer l’agenda.");
      return;
    }

    const agenda = [...(printableCalendar.data ?? [])].sort((a, b) =>
      a.slot.date.localeCompare(b.slot.date)
    );

    if (!agenda.length) {
      window.alert("Aucune date n’est enregistrée dans l’agenda.");
      return;
    }

    const months = new Map<string, typeof agenda>();
    agenda.forEach((entry) => {
      const key = entry.slot.date.slice(0, 7);
      months.set(key, [...(months.get(key) ?? []), entry]);
    });

    const monthHtml = [...months.entries()].map(([key, entries]) => {
      const [year, monthNumber] = key.split("-").map(Number);
      const first = new Date(year, monthNumber - 1, 1, 12);
      const numberOfDays = new Date(year, monthNumber, 0).getDate();
      const firstWeekday = first.getDay();
      const byDate = groupSlotsByDate(entries);
      const cells: string[] = [];

      for (let i = 0; i < firstWeekday; i++) {
        cells.push('<div class="day empty"></div>');
      }

      for (let day = 1; day <= numberOfDays; day++) {
        const date = `${year}-${String(monthNumber).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const dayEntries = byDate.get(date) ?? [];

        if (!dayEntries.length) {
          cells.push(`<div class="day"><strong>${day}</strong></div>`);
          continue;
        }

        const details = dayEntries.map((entry) => {
          const status = entry.slot.status as SlotStatus;
          const request = entry.request;

          let label = "";
          let css = "";

          if (status === "AVAILABLE") {
            label = "DISPONIBLE";
            css = "available";
          } else if (status === "PENDING_CONFIRMATION") {
            label = "EN ATTENTE";
            css = "pending";
          } else if (status === "CONFIRMED") {
            label = "CONFIRMÉE";
            css = "confirmed";
          } else {
            label = "INDISPONIBLE";
            css = "unavailable";
          }

          const church =
            status === "CONFIRMED" && request?.church
              ? `<div class="church">${escapeHtml(request.church)}</div>`
              : status === "PENDING_CONFIRMATION" && request?.church
                ? `<div class="church">${escapeHtml(request.church)}</div>`
                : "";

          const federation =
            request?.federation && (status === "CONFIRMED" || status === "PENDING_CONFIRMATION")
              ? `<div class="detail">${escapeHtml(request.federation)}</div>`
              : "";

          const time =
            status === "CONFIRMED" && request?.desiredTime
              ? `<div class="detail">${escapeHtml(request.desiredTime)}</div>`
              : "";

          return `
            <div class="${css}" style="padding: 3px; margin-top: 3px;">
              <div class="detail">${escapeHtml(entry.department?.name ?? `Département #${entry.slot.departmentId}`)}</div>
              <div class="detail">${escapeHtml(entry.slot.federation)}</div>
              <div class="status">${label}</div>
              ${church}
              ${federation}
              ${time}
            </div>
          `;
        }).join("");
        cells.push(`<div class="day"><strong>${day}</strong>${details}</div>`);
      }

      while (cells.length % 7) {
        cells.push('<div class="day empty"></div>');
      }

      const title = first.toLocaleDateString("fr-FR", {
        month: "long",
        year: "numeric",
      });

      return `
        <section class="month">
          <header>
            <div>
              <div class="gcv">GCV-UFB</div>
              <h1>Agenda UFB</h1>
            </div>
            <h2>${escapeHtml(title)}</h2>
          </header>

          <div class="weekdays">
            <div>DIMANCHE</div>
            <div>LUNDI</div>
            <div>MARDI</div>
            <div>MERCREDI</div>
            <div>JEUDI</div>
            <div>VENDREDI</div>
            <div>SAMEDI</div>
          </div>

          <div class="calendar">${cells.join("")}</div>

          <div class="legend">
            DISPONIBLE · EN ATTENTE · CONFIRMÉE · INDISPONIBLE
          </div>
        </section>
      `;
    }).join("");

    const printRoot = document.createElement("div");
    printRoot.id = "gcv-print-agenda";
    printRoot.innerHTML = `
      <style>
        #gcv-print-agenda { display: none; }

        @media print {
          @page { size: A4 landscape; margin: 10mm; }

          body > * { display: none !important; }

          #gcv-print-agenda {
            display: block !important;
            font-family: Arial, Helvetica, sans-serif;
            color: #17384d;
          }

          #gcv-print-agenda .month {
            break-after: page;
            page-break-after: always;
          }

          #gcv-print-agenda .month:last-child {
            break-after: auto;
            page-break-after: auto;
          }

          #gcv-print-agenda header {
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
            margin-bottom: 12px;
          }

          #gcv-print-agenda .gcv {
            font-size: 10px;
            font-weight: 800;
            letter-spacing: 1px;
          }

          #gcv-print-agenda h1 {
            margin: 2px 0;
            font-size: 23px;
          }

          #gcv-print-agenda h2 {
            margin: 0;
            font-size: 21px;
            text-transform: capitalize;
          }

          #gcv-print-agenda .weekdays,
          #gcv-print-agenda .calendar {
            display: grid;
            grid-template-columns: repeat(7, 1fr);
          }

          #gcv-print-agenda .weekdays div {
            border: 1px solid #aebfc9;
            padding: 6px 3px;
            text-align: center;
            font-size: 9px;
            font-weight: 800;
            background: #eaf3f8;
          }

          #gcv-print-agenda .day {
            min-height: 29mm;
            border: 1px solid #cbd7de;
            padding: 5px;
            font-size: 10px;
            overflow: hidden;
          }

          #gcv-print-agenda .day strong {
            font-size: 14px;
          }

          #gcv-print-agenda .empty {
            background: #f7f7f7;
          }

          #gcv-print-agenda .available {
            background: #edf8f1;
          }

          #gcv-print-agenda .pending {
            background: #fff7df;
          }

          #gcv-print-agenda .confirmed {
            background: #e7f0f8;
            border: 2px solid #245f83;
          }

          #gcv-print-agenda .unavailable {
            background: #f0f1f2;
          }

          #gcv-print-agenda .status {
            margin-top: 5px;
            font-size: 8px;
            font-weight: 800;
          }

          #gcv-print-agenda .church {
            margin-top: 5px;
            font-size: 10px;
            font-weight: 800;
          }

          #gcv-print-agenda .detail {
            margin-top: 2px;
            font-size: 8px;
          }

          #gcv-print-agenda .legend {
            margin-top: 8px;
            font-size: 8px;
          }
        }
      </style>
      ${monthHtml}
    `;

    document.body.appendChild(printRoot);

    const cleanup = () => {
      document.getElementById("gcv-print-agenda")?.remove();
      window.removeEventListener("afterprint", cleanup);
    };

    window.addEventListener("afterprint", cleanup);
    window.print();

    window.setTimeout(cleanup, 30000);
  };
  return <ScreenContainer containerClassName="bg-[#F4F8FB]" className="px-5"><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Text style={styles.back} onPress={() => router.back()}>‹ Tableau de bord</Text><Text style={styles.kicker}>ESPACE ADMINISTRATEUR</Text><Text style={styles.title}>Agenda UFB</Text>
    <SectionCard>
      <Text style={styles.section}>Imprimer l’agenda</Text>
      <Text style={styles.help}>Imprimez les disponibilités et invitations des départements et fédérations sélectionnés, sur tous les mois, ou enregistrez-les au format PDF. L’agenda imprimé ne contient ni adresse e-mail ni numéro de téléphone.</Text>
      <PrimaryButton
        label={printableCalendar.isLoading ? "CHARGEMENT DE L’AGENDA…" : "IMPRIMER L’AGENDA"}
        icon="print-outline"
        tone="secondary"
        disabled={printableCalendar.isLoading || printableCalendar.isError}
        onPress={printAgenda}
      />
      {printableCalendar.isError ? <Text style={styles.error}>L’agenda des engagements confirmés ne peut pas être chargé pour le moment.</Text> : null}
    </SectionCard>
    {canWrite ? <>
    <InterventionTypeManager departments={departments.data ?? []} />
    <SectionCard>
      <Text style={styles.section}>Créer des disponibilités</Text>

      <Text style={styles.fieldLabel}>Département *</Text>
      <View style={styles.filters}>
        {(departments.data ?? []).map((department) => (
          <Chip
            key={department.id}
            label={department.name}
            selected={creationDepartmentId === department.id}
            onPress={() => {
              setCreationDepartmentId(department.id);
            }}
          />
        ))}
      </View>
      {departments.isLoading ? <Text style={styles.help}>Chargement des départements…</Text> : null}
      {departments.isError ? <Text style={styles.error}>Les départements ne peuvent pas être chargés.</Text> : null}

      <Text style={styles.fieldLabel}>Fédération de ces disponibilités *</Text><View style={styles.filters}>{federations.map((value) => <Chip key={value} label={value} selected={creationFederation === value} onPress={() => setCreationFederation(value)} />)}</View><Text style={styles.help}>Choisissez d’abord la fédération. Les dates créées seront proposées uniquement aux églises de cette fédération.</Text><Field label="Ajouter une date * (JJ/MM/AAAA)" value={manual} onChangeText={setManual} placeholder="03/10/2026" autoCapitalize="none"/>
      {!creationDepartmentId ? (
        <Text style={styles.error}>Sélectionnez un département pour continuer.</Text>
      ) : null}
      {!creationFederation ? (
        <Text style={styles.error}>Sélectionnez une fédération pour continuer.</Text>
      ) : null}
      {manual.trim() && !manualIso ? (
        <Text style={styles.error}>Vérifiez la date saisie (JJ/MM/AAAA).</Text>
      ) : null}
      {!manual.trim() ? (
        <Text style={styles.help}>Indiquez une date pour créer une disponibilité.</Text>
      ) : null}
      <PrimaryButton label="AJOUTER LA DATE" icon="add-circle-outline" disabled={!creationDepartmentId || !creationFederation || !manualIso || create.isPending} onPress={() => manualIso && add([manualIso])}/><View style={styles.divider}/><Text style={styles.help}>Générer les samedis ou week-ends entre deux dates</Text><Field label="Du (JJ/MM/AAAA)" value={rangeStart} onChangeText={setRangeStart} placeholder="01/10/2026" autoCapitalize="none"/><Field label="Au (JJ/MM/AAAA)" value={rangeEnd} onChangeText={setRangeEnd} placeholder="31/12/2026" autoCapitalize="none"/><View style={styles.filters}><Chip label="Samedis" selected={rangeMode === "saturdays"} onPress={() => setRangeMode("saturdays")}/><Chip label="Samedis et dimanches" selected={rangeMode === "weekends"} onPress={() => setRangeMode("weekends")}/></View><PrimaryButton label="GÉNÉRER LES DATES" tone="secondary" icon="repeat-outline" disabled={!creationDepartmentId || !creationFederation || !rangeStartIso || !rangeEndIso || create.isPending} onPress={() => rangeStartIso && rangeEndIso && add(makeDates(rangeStartIso, rangeEndIso, rangeMode))}/>{create.data ? <Text style={styles.feedback}>{create.data.created} date(s) ajoutée(s), {create.data.skipped} existante(s).</Text> : null}{create.error ? <Text style={styles.error}>{create.error.message}</Text> : null}</SectionCard>
    </> : null}
    <SectionCard><Text style={styles.section}>Vue mensuelle</Text><View style={styles.monthNav}><Pressable accessibilityRole="button" onPress={() => shiftMonth(-1)}><Text style={styles.nav}>‹ Mois précédent</Text></Pressable><Text style={styles.month}>{new Date(`${month}-01T12:00:00`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}</Text><Pressable accessibilityRole="button" onPress={() => shiftMonth(1)}><Text style={styles.nav}>Suivant ›</Text></Pressable></View><View style={{ marginTop: 12, gap: 8 }}>
        <Field
          label="Aller au mois (MM/AAAA)"
          value={targetMonth}
          onChangeText={setTargetMonth}
          placeholder="01/2098"
          autoCapitalize="none"
        />
        <PrimaryButton
          label="AFFICHER CE MOIS"
          tone="secondary"
          disabled={!/^(0[1-9]|1[0-2])\/(19|20|21)\d{2}$/.test(targetMonth.trim())}
          onPress={() => {
            const [mm, yyyy] = targetMonth.trim().split("/");
            setMonth(`${yyyy}-${mm}`);
            setSelectedSlotId(null);
          }}
        />
      </View><Text style={styles.fieldLabel}>Département</Text>
      <View style={styles.filters}>
        <Chip label="Tous les départements autorisés" selected={departmentId === undefined} onPress={() => { setDepartmentId(undefined); setSelectedSlotId(null); }} />
        {(departments.data ?? []).map((department) => <Chip key={department.id} label={department.name} selected={departmentId === department.id} onPress={() => { setDepartmentId(department.id); setSelectedSlotId(null); }} />)}
      </View>
      {departments.isLoading ? <Text style={styles.help}>Chargement des départements…</Text> : null}
      {departments.isError ? <Text style={styles.error}>Les départements ne peuvent pas être chargés.</Text> : null}
      <Text style={styles.fieldLabel}>Statut des dates</Text><View style={styles.filters}>{(["ALL", "AVAILABLE", "PENDING_CONFIRMATION", "CONFIRMED", "UNAVAILABLE"] as const).map((value) => <Chip key={value} label={value === "ALL" ? "Toutes" : STATUS_META[value].label} selected={status === value} onPress={() => { setStatus(value); setSelectedSlotId(null); }}/>)}</View><Text style={styles.fieldLabel}>Fédération</Text><View style={styles.filters}>{["", ...federations].map((value) => <Chip key={value || "ALL"} label={value || "Toutes"} selected={federation === value} onPress={() => { setFederation(value); setSelectedSlotId(null); }}/>)}</View>
      {calendar.isLoading ? <LoadingBlock label="Chargement de l’agenda…"/> : calendar.error ? <Text style={styles.error}>{calendar.error.message}</Text> : <><View style={styles.grid}>
        {weekdays.map((day, index) => <View key={`${day}-${index}`} style={styles.weekday}><Text style={styles.weekdayText}>{day}</Text></View>)}
        {days.map((item, index) => item ? <View key={item.date} style={styles.dayCell}>
          <Pressable accessibilityRole="button" accessibilityLabel={`${toFrenchDate(item.date)} : ${item.entries.length} disponibilité(s)`} onPress={() => { if (!item.entries.length) setManual(item.date.split("-").reverse().join("/")); }}><Text style={styles.dayNumber}>{item.day}</Text></Pressable>
          {item.entries.map((entry) => <Pressable key={entry.slot.id} accessibilityRole="button" accessibilityState={{ selected: selectedSlotId === entry.slot.id }} accessibilityLabel={`${toFrenchDate(item.date)} · ${entry.department?.name ?? `Département #${entry.slot.departmentId}`} · ${entry.slot.federation} · ${STATUS_META[entry.slot.status as SlotStatus].label}`} onPress={() => setSelectedSlotId(entry.slot.id)} style={[styles.slotChip, { backgroundColor: STATUS_META[entry.slot.status as SlotStatus].background, borderColor: STATUS_META[entry.slot.status as SlotStatus].color }, selectedSlotId === entry.slot.id && styles.selectedDay]}>
            <Text style={styles.dayFederation}>{entry.department?.code ?? `#${entry.slot.departmentId}`} · {entry.slot.federation}</Text>
            <Text style={styles.dayFederation}>{STATUS_META[entry.slot.status as SlotStatus].label}</Text>
          </Pressable>)}
        </View> : <View key={`pad-${index}`} style={styles.dayCellEmpty}/>)}
      </View><View style={styles.legend}>{(["AVAILABLE", "PENDING_CONFIRMATION", "CONFIRMED", "UNAVAILABLE"] as const).map((value) => <View key={value} style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: STATUS_META[value].color }]} /><Text style={styles.legendText}>{STATUS_META[value].label}</Text></View>)}</View></>}
    </SectionCard>
    {selected ? <SectionCard><View style={styles.slotTop}><View style={{ flex: 1, gap: 3 }}><Text style={styles.date}>{toFrenchDate(selected.slot.date)}</Text>{selected.request ? <Text style={styles.contact}>{selected.request.church} · {selected.request.contactName}</Text> : <Text style={styles.help}>Aucune invitation active associée</Text>}</View><StatusPill status={selected.slot.status}/></View><Text style={styles.federationDetail}>Département : {selected.department?.name ?? `Département #${selected.slot.departmentId}`}</Text><Text style={styles.federationDetail}>Fédération : {selected.slot.federation ?? selected.request?.federation ?? "Non attribuée"}</Text>{canWrite && (selected.slot.status === "AVAILABLE" || selected.slot.status === "UNAVAILABLE") ? <><Text style={styles.fieldLabel}>Attribuer cette date à une fédération</Text><View style={styles.filters}>{federations.map((value) => <Chip key={value} label={value} selected={selected.slot.federation === value} onPress={() => confirm("Modifier la fédération ?", `${toFrenchDate(selected.slot.date)} → ${value}`, () => updateFederation.mutate({ slotId: selected.slot.id, federation: value }))} />)}</View></> : null}{selected.request ? <Text style={styles.help}>{selected.request.email}{selected.request.desiredTime ? ` · ${selected.request.desiredTime}` : ""}</Text> : null}{canWrite ? (
  <>
    {selected.slot.status === "AVAILABLE" ? <PrimaryButton label="BLOQUER LA DATE" tone="warning" onPress={() => confirm("Bloquer cette date ?", toFrenchDate(selected.slot.date), () => update.mutate({ slotId: selected.slot.id, status: "UNAVAILABLE" }))} disabled={update.isPending}/> : selected.slot.status === "UNAVAILABLE" ? <PrimaryButton label="LIBÉRER LA DATE" tone="secondary" onPress={() => confirm("Rendre cette date disponible ?", toFrenchDate(selected.slot.date), () => update.mutate({ slotId: selected.slot.id, status: "AVAILABLE" }))} disabled={update.isPending}/> : <PrimaryButton label="GÉRER L’INVITATION" icon="open-outline" onPress={() => router.push(
  selected.request
    ? ({ pathname: "/admin/requests", params: { requestId: String(selected.request.id) } } as never)
    : ("/admin/requests" as never)
)}/>}
    {!selected.request && (selected.slot.status === "AVAILABLE" || selected.slot.status === "UNAVAILABLE") ? <PrimaryButton label="SUPPRIMER CETTE DATE VIDE" tone="danger" icon="trash-outline" onPress={() => confirm("Supprimer définitivement cette date ?", "Seules les dates sans aucune invitation ni historique peuvent être supprimées.", () => remove.mutate({ slotId: selected.slot.id }), true)} disabled={remove.isPending}/> : null}
  </>
) : selected.request ? (
  <PrimaryButton label="VOIR L’INVITATION" tone="secondary" icon="open-outline" onPress={() => router.push(
  selected.request
    ? ({ pathname: "/admin/requests", params: { requestId: String(selected.request.id) } } as never)
    : ("/admin/requests" as never)
)}/>
) : null}{update.error || remove.error ? <Text style={styles.error}>{update.error?.message ?? remove.error?.message}</Text> : null}</SectionCard> : null}
    {!calendar.isLoading && !calendar.error && !entries.length ? <EmptyState title="Aucune date ce mois-ci" detail="Touchez un jour vide pour le reprendre dans le champ de création, ou ajoutez une disponibilité."/> : null}
  </ScrollView></ScreenContainer>;
}
function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) { return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[styles.chip, selected && styles.chipSelected]}><Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text></Pressable>; }
const styles = StyleSheet.create<any>({
  content: { paddingTop: 18, paddingBottom: 40, gap: 14, alignSelf: "center", width: "100%", maxWidth: 900 }, back: { color: GCV.blue, fontWeight: "800" }, kicker: { color: GCV.blue, fontSize: 10, fontWeight: "900", letterSpacing: 1.1 }, title: { color: GCV.navy, fontSize: 28, fontWeight: "900" }, section: { color: GCV.navy, fontSize: 16, fontWeight: "850" }, help: { color: GCV.muted, fontSize: 12, lineHeight: 18 }, fieldLabel: { color: GCV.text, fontSize: 12, fontWeight: "800" }, divider: { height: 1, backgroundColor: GCV.border, marginVertical: 3 }, feedback: { color: "#176B43", fontSize: 13, fontWeight: "700" }, error: { color: GCV.danger, fontSize: 12, fontWeight: "800" },
  monthNav: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }, month: { color: GCV.navy, fontWeight: "850", textTransform: "capitalize", fontSize: 14 }, nav: { color: GCV.blue, fontSize: 12, fontWeight: "800" }, filters: { flexDirection: "row", flexWrap: "wrap", gap: 6 }, chip: { borderWidth: 1, borderColor: GCV.border, borderRadius: 99, paddingVertical: 7, paddingHorizontal: 10, backgroundColor: "#fff" }, chipSelected: { backgroundColor: GCV.navy, borderColor: GCV.navy }, chipText: { color: GCV.text, fontSize: 10, fontWeight: "800" }, chipTextSelected: { color: "#fff" },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-start", gap: "0.8%" }, weekday: { width: "13.6%", alignItems: "center", paddingVertical: 7 }, weekdayText: { color: GCV.muted, fontSize: 11, fontWeight: "900" }, dayCell: { width: "13.6%", minHeight: 96, marginBottom: 4, padding: 3, borderWidth: 1, borderColor: GCV.border, borderRadius: 9, backgroundColor: "#fff", alignItems: "center", justifyContent: "flex-start", gap: 4 }, slotChip: { width: "100%", borderWidth: 1, borderRadius: 5, paddingVertical: 5, paddingHorizontal: 2, gap: 2 }, dayCellEmpty: { width: "13.6%", aspectRatio: 0.92, marginBottom: 4 }, selectedDay: { borderWidth: 2, borderColor: GCV.navy }, dayNumber: { color: GCV.text, fontSize: 13, fontWeight: "850" }, dayFederation: { color: GCV.navy, fontSize: 9, fontWeight: "900" }, dot: { width: 5, height: 5, borderRadius: 5 }, legend: { flexDirection: "row", flexWrap: "wrap", gap: 10, paddingTop: 7 }, legendItem: { flexDirection: "row", alignItems: "center", gap: 5 }, legendDot: { width: 8, height: 8, borderRadius: 8 }, legendText: { color: GCV.muted, fontSize: 10, fontWeight: "750" },
  slotTop: { flexDirection: "row", gap: 8 }, date: { color: GCV.navy, fontSize: 16, fontWeight: "850", textTransform: "capitalize" }, contact: { color: GCV.text, fontSize: 13, fontWeight: "700" }, federationDetail: { color: GCV.navy, fontSize: 13, fontWeight: "850" },
});
