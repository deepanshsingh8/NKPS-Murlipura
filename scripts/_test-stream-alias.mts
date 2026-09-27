// Stream-alias resolver checks for packages/shared/src/lib/stream-alias.ts.
//
// The bug this guards: the school stores the humanities stream as
// "Humanities" while every import file in the building says "Arts". A bare
// name lookup misses, which drops that class's whole fee schedule AND makes
// the importer create a second stream beside the real one. Neither errors.
//
//   npx tsx scripts/_test-stream-alias.mts

import { buildStreamLookup, resolveStreamId, streamIsMissing } from "../packages/shared/src/lib/stream-alias";
const L = buildStreamLookup([{id:"h",name:"Humanities"},{id:"s",name:"Science"},{id:"c",name:"Commerce"}]);
let failed = 0;
const t = (l:string,a:unknown,b:unknown)=>{
  const ok = JSON.stringify(a)===JSON.stringify(b);
  if (!ok) failed++;
  console.log(ok?`PASS ${l}`:`FAIL ${l}  got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
};
t("Arts -> Humanities id", resolveStreamId(L,"Arts"), "h");
t("arts lowercase",        resolveStreamId(L,"arts"), "h");
t("Humanities direct",     resolveStreamId(L,"Humanities"), "h");
t("Science",               resolveStreamId(L,"Science"), "s");
t("Commerce",              resolveStreamId(L,"Commerce"), "c");
t("Arts is NOT missing",   streamIsMissing(L,"Arts"), false);
t("unknown IS missing",    streamIsMissing(L,"Vocational"), true);
t("blank resolves null",   resolveStreamId(L,""), null);
const L2 = buildStreamLookup([{id:"a",name:"Arts"}]);
t("school storing 'Arts': Humanities resolves too", resolveStreamId(L2,"Humanities"), "a");

// Non-zero exit so this can gate a commit.
console.log(failed === 0 ? `\n${9 - failed} passed, 0 failed` : `\n${failed} failed`);
process.exit(failed ? 1 : 0);
