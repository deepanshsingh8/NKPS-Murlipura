// Allocation-engine checks for apps/erp/src/lib/fee-allocation.ts.
//
// The repo has no test runner, so this follows the scripts/_* diagnostic
// convention. Run it after touching the waterfall:
//
//   npx tsx scripts/_test-fee-allocation.mts
//
// Exits non-zero on the first failure so it can gate a commit.

import {
  allocateStudentReceipts, groupScheduleByHead, buildImportReceiptNumber,
  type AllocatableStructure,
} from "../apps/erp/src/lib/fee-allocation";

let pass = 0, fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log("PASS", label); }
  else { fail++; console.log("FAIL", label, "\n   got :", g, "\n   want:", w); }
};

const S = (id: string, fee_type: string, amount: number, due: string, no: number, name: string): AllocatableStructure =>
  ({ id, fee_type, amount, frequency: "one_time", due_date: due, instalment_no: no, instalment_name: name, month_label: null } as AllocatableStructure);

// A 2-instalment tuition schedule + a one-off admission fee.
const schedule = groupScheduleByHead([
  S("t2", "Tuition Fee", 11300, "2026-10-01", 2, "2nd Instalment"),
  S("t1", "Tuition Fee", 11300, "2026-04-01", 1, "1st Instalment"),
  S("a1", "Admission Fee", 10500, "2026-04-01", 1, "Admission/Regn. Fee"),
]);
eq("schedule sorted oldest-due-first", schedule.get("TUITION FEE")!.map(r=>r.id), ["t1","t2"]);

const R = (no: string, date: string, heads: Array<[string, number]>) =>
  ({ receipt_no: no, source_row: Number(no), payment_date: date, heads: heads.map(([head, amount]) => ({ head, amount })) });

// 1. Exact single instalment
let r = allocateStudentReceipts({ receipts: [R("1","2026-04-05",[["Tuition Fee",11300]])], scheduleByHead: schedule });
eq("exact: one slice on t1", r.slices.map(s=>[s.fee_structure_id,s.amount,s.partial,s.over_allocated]), [["t1",11300,false,false]]);

// 2. Spanning two instalments
r = allocateStudentReceipts({ receipts: [R("2","2026-04-05",[["Tuition Fee",22600]])], scheduleByHead: schedule });
eq("spanning: splits t1+t2", r.slices.map(s=>[s.fee_structure_id,s.amount,s.slice_no]), [["t1",11300,1],["t2",11300,2]]);

// 3. Partial
r = allocateStudentReceipts({ receipts: [R("3","2026-04-05",[["Tuition Fee",5833]])], scheduleByHead: schedule });
eq("partial: flagged", r.slices.map(s=>[s.fee_structure_id,s.amount,s.partial]), [["t1",5833,true]]);

// 4. Two receipts, running balance carries
r = allocateStudentReceipts({ receipts: [R("5","2026-07-01",[["Tuition Fee",6000]]), R("4","2026-04-05",[["Tuition Fee",5300]])], scheduleByHead: schedule });
eq("multi-receipt: oldest first, balance carries",
   r.slices.map(s=>[s.receipt_no,s.fee_structure_id,s.amount]),
   [["4","t1",5300],["5","t1",6000]]);

// 5. Over-allocation
r = allocateStudentReceipts({ receipts: [R("6","2026-04-05",[["Tuition Fee",30000]])], scheduleByHead: schedule });
eq("over-allocation: surplus on last row, flagged",
   r.slices.map(s=>[s.fee_structure_id,s.amount,s.over_allocated]),
   [["t1",11300,false],["t2",11300,false],["t2",7400,true]]);

// 6. Head with no schedule row
r = allocateStudentReceipts({ receipts: [R("7","2026-04-05",[["Transport Fee",4000]])], scheduleByHead: schedule });
eq("missing head: no slices", r.slices.length, 0);
eq("missing head: one problem", r.problems.map(p=>p.head), ["Transport Fee"]);

// 7. Two heads in one receipt
r = allocateStudentReceipts({ receipts: [R("8","2026-04-05",[["Admission Fee",10500],["Tuition Fee",11300]])], scheduleByHead: schedule });
eq("two heads: independent waterfalls, slice_no continues",
   r.slices.map(s=>[s.head,s.fee_structure_id,s.slice_no]),
   [["Admission Fee","a1",1],["Tuition Fee","t1",2]]);

// 8. alreadyFilledPaise — a re-run must not re-fill a settled instalment
r = allocateStudentReceipts({ receipts: [R("9","2026-07-01",[["Tuition Fee",11300]])], scheduleByHead: schedule,
                              alreadyFilledPaise: new Map([["t1", 11300*100]]) });
eq("already filled: skips t1, lands on t2", r.slices.map(s=>[s.fee_structure_id,s.amount]), [["t2",11300]]);

// 9. Paise-level: no float leakage across a 3-way split
const thirds = groupScheduleByHead([
  S("x1","Tuition Fee",3333.33,"2026-04-01",1,"1st"), S("x2","Tuition Fee",3333.33,"2026-07-01",2,"2nd"), S("x3","Tuition Fee",3333.34,"2026-10-01",3,"3rd"),
]);
r = allocateStudentReceipts({ receipts: [R("10","2026-04-05",[["Tuition Fee",10000]])], scheduleByHead: thirds });
eq("paise: sums back to exactly 10000", r.slices.reduce((a,s)=>a+s.amount,0), 10000);
eq("paise: no over-allocation", r.slices.some(s=>s.over_allocated), false);

// 10. Head matching is case/space insensitive
r = allocateStudentReceipts({ receipts: [R("11","2026-04-05",[["  tuition   fee ",11300]])], scheduleByHead: schedule });
eq("head key normalised", r.slices.map(s=>s.fee_structure_id), ["t1"]);

// 11. Receipt number shape
eq("receipt number", buildImportReceiptNumber("2026","1242",2), "DB-2026-1242-2");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
