import type {
  EffectiveFeeLine,
  FeeStructure,
  TransportFareSlab,
  TransportFeeLine,
} from "@nkps/shared/types";

export const FEE_FREQ_MULTIPLIER: Record<string, number> = {
  monthly: 12,
  quarterly: 4,
  annual: 1,
  one_time: 1,
};

type Annualizable = { amount: number | string; frequency: string };

export function annualizedAmount(fs: Annualizable): number {
  const mult = FEE_FREQ_MULTIPLIER[fs.frequency] ?? 1;
  return Number(fs.amount) * mult;
}

export function sumAnnualized(structures: Annualizable[]): number {
  return structures.reduce((sum, fs) => sum + annualizedAmount(fs), 0);
}

// Resolve which fee_structures rows actually apply to a given student.
//
// Override rule: if a stream-specific structure exists for the student's
// stream and a given fee_type, the class-wide (stream_id NULL) structure for
// the same fee_type is hidden. Structures belonging to other streams are
// dropped. Transport rows shouldn't exist in fee_structures any more (they
// live in transport_fare_slabs after migration 050) — but we filter defensively.
export function resolveEffectiveFeeStructures(
  structures: FeeStructure[],
  opts: { studentStreamId: string | null }
): FeeStructure[] {
  const { studentStreamId } = opts;

  const visible = structures.filter((fs) => {
    if (fs.fee_type === "Transport") return false;
    if (fs.stream_id && fs.stream_id !== studentStreamId) return false;
    return true;
  });

  const overriddenTypes = new Set(
    visible
      .filter((fs) => fs.stream_id && fs.stream_id === studentStreamId)
      .map((fs) => fs.fee_type)
  );

  return visible.filter(
    (fs) => !(fs.stream_id == null && overriddenTypes.has(fs.fee_type))
  );
}

// Synthesize a transport fee line from the student's selected slab. Returns
// null if the student isn't opted in or the slab isn't found / inactive.
export function resolveTransportLine(opts: {
  hasTransport: boolean;
  transportSlabId: string | null;
  slabs: Pick<
    TransportFareSlab,
    "id" | "name" | "amount" | "frequency" | "is_active"
  >[];
}): TransportFeeLine | null {
  const { hasTransport, transportSlabId, slabs } = opts;
  if (!hasTransport || !transportSlabId) return null;
  const slab = slabs.find((s) => s.id === transportSlabId && s.is_active);
  if (!slab) return null;
  return {
    kind: "transport_slab",
    id: slab.id,
    fee_type: "Transport",
    amount: Number(slab.amount),
    frequency: slab.frequency,
    due_date: null,
    late_fee_percent: 0,
    late_fee_fixed_amount: 0,
    stream_id: null,
    slab_name: slab.name,
  };
}

// Combine the academic and transport lines into one array consumers can map
// over. `fee_structure` rows get a `kind: 'fee_structure'` tag so caller can
// branch when recording payments (different FK).
export function resolveEffectiveFeeLines(opts: {
  structures: FeeStructure[];
  studentStreamId: string | null;
  hasTransport: boolean;
  transportSlabId: string | null;
  slabs: Pick<
    TransportFareSlab,
    "id" | "name" | "amount" | "frequency" | "is_active"
  >[];
}): EffectiveFeeLine[] {
  const academic = resolveEffectiveFeeStructures(opts.structures, {
    studentStreamId: opts.studentStreamId,
  }).map<EffectiveFeeLine>((fs) => ({ ...fs, kind: "fee_structure" }));
  const transport = resolveTransportLine(opts);
  return transport ? [...academic, transport] : academic;
}
