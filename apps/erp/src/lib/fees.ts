import type {
  EffectiveFeeLine,
  FeeFrequency,
  FeeStructure,
  TransportDirection,
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
// live in bus_stop_fees after migration 074) — but we filter defensively.
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

// A per-year fee row for a stop, joined with its stop name.
export type StopFeeLookup = {
  bus_stop_id: string;
  stop_name: string;
  amount: number | string;
  frequency: string;
  is_active: boolean;
};

// Synthesize a transport fee line from the student's assigned bus stop.
//
// Fee is the stop's flat amount, UNLESS the student has a one-side facility
// (direction != 'both'), in which case the per-student custom override is the
// billed amount. Returns null if the student isn't opted in, has no stop, or
// the stop has no active fee for the year.
export function resolveTransportLine(opts: {
  hasTransport: boolean;
  busStopId: string | null;
  direction: TransportDirection;
  feeOverride: number | null;
  stopFees: StopFeeLookup[];
}): TransportFeeLine | null {
  const { hasTransport, busStopId, direction, feeOverride, stopFees } = opts;
  if (!hasTransport || !busStopId) return null;
  const fee = stopFees.find((f) => f.bus_stop_id === busStopId && f.is_active);
  if (!fee) return null;

  const isOneSide = direction !== "both";
  const amount =
    isOneSide && feeOverride != null ? Number(feeOverride) : Number(fee.amount);

  return {
    kind: "transport_stop",
    id: fee.bus_stop_id,
    fee_type: "Transport",
    amount,
    frequency: fee.frequency as FeeFrequency,
    due_date: null,
    late_fee_percent: 0,
    late_fee_fixed_amount: 0,
    late_fee_per_day: 0,
    late_fee_max: null,
    stream_id: null,
    stop_name: fee.stop_name,
    direction,
  };
}

// Combine the academic and transport lines into one array consumers can map
// over. `fee_structure` rows get a `kind: 'fee_structure'` tag so caller can
// branch when recording payments (different FK).
export function resolveEffectiveFeeLines(opts: {
  structures: FeeStructure[];
  studentStreamId: string | null;
  hasTransport: boolean;
  busStopId: string | null;
  direction: TransportDirection;
  feeOverride: number | null;
  stopFees: StopFeeLookup[];
}): EffectiveFeeLine[] {
  const academic = resolveEffectiveFeeStructures(opts.structures, {
    studentStreamId: opts.studentStreamId,
  }).map<EffectiveFeeLine>((fs) => ({ ...fs, kind: "fee_structure" }));
  const transport = resolveTransportLine(opts);
  return transport ? [...academic, transport] : academic;
}
