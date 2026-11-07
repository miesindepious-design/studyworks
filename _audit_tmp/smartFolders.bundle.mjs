// src/utils/smartFolders.ts
function evaluateAlternative(rule, note) {
  const trimmed = rule.trim().toLowerCase();
  if (!trimmed) return null;
  const negated = trimmed.startsWith("-");
  const body = negated ? trimmed.slice(1) : trimmed;
  let match = null;
  if (body.startsWith("tag:")) {
    const tagValue = body.slice(4);
    match = note.tags.some((t) => t.toLowerCase() === tagValue);
  } else if (body.startsWith("type:")) {
    match = note.type === body.slice(5);
  } else if (body === "has:summary") {
    match = !!note.summary;
  } else if (body === "has:reminder") {
    match = !!note.nextReminder;
  } else if (body === "has:highlights") {
    match = (note.highlights?.length ?? 0) > 0;
  } else if (body === "has:attachments") {
    match = (note.files?.length ?? 0) > 0;
  }
  if (match === null) return null;
  return negated ? !match : match;
}
function evaluateClause(clause, note) {
  const alternatives = clause.split("|").map((a) => a.trim()).filter(Boolean);
  if (alternatives.length === 0) return true;
  if (alternatives.length === 1) {
    const r = evaluateAlternative(alternatives[0], note);
    return r === null ? true : r;
  }
  const results = alternatives.map((a) => evaluateAlternative(a, note));
  if (results.every((r) => r === null)) return true;
  return results.some((r) => r === true);
}
function matchesSmartFilter(note, smartFilter) {
  if (!smartFilter) return true;
  const clauses = smartFilter.split(",").filter(Boolean);
  return clauses.every((clause) => evaluateClause(clause, note));
}
function describeAlternative(rule) {
  const trimmed = rule.trim();
  const lower = trimmed.toLowerCase();
  const negated = lower.startsWith("-");
  const body = negated ? lower.slice(1) : lower;
  const prefix = negated ? "not " : "";
  if (body.startsWith("tag:")) return `${prefix}tagged "${body.slice(4)}"`;
  if (body.startsWith("type:")) return `${prefix}type = ${body.slice(5)}`;
  if (body === "has:summary") return `${prefix}has AI summary`;
  if (body === "has:reminder") return `${prefix}has reminder`;
  if (body === "has:highlights") return `${prefix}has highlights`;
  if (body === "has:attachments") return `${prefix}has attachments`;
  return trimmed;
}
function previewSmartFilter(filter) {
  const clauses = filter.split(",").filter(Boolean);
  return clauses.map((clause) => {
    const alternatives = clause.split("|").map((a) => a.trim()).filter(Boolean);
    if (alternatives.length === 0) return "";
    return alternatives.map(describeAlternative).join(" or ");
  }).filter(Boolean).join(" + ");
}
export {
  matchesSmartFilter,
  previewSmartFilter
};
