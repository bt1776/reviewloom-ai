// Heuristic review-reply grader (used as fallback when no LLM key is set or the LLM fails).
function gradeHeuristic(review, reply, rating) {
  const r = String(review || ''), p = String(reply || '').trim(), low = p.toLowerCase();
  const neg = rating ? rating <= 3 : /\b(bad|terrible|worst|rude|never again|disappoint|awful|horrible|waited|cold|dirty|overcharg|refund|unprofessional|late)\b/i.test(r);
  const tips = [], strengths = [];
  let score = 50;
  const words = p.split(/\s+/).filter(Boolean).length;
  if (/\b(thank|thanks|appreciate|grateful)\b/i.test(p)) { score += 10; strengths.push('Thanks the reviewer.'); } else tips.push('Open by thanking the reviewer for taking the time to write.');
  const rw = new Set((r.toLowerCase().match(/[a-z]{5,}/g) || []).filter(w => !['really', 'there', 'their', 'would', 'about', 'which', 'these', 'great', 'thank', 'service'].includes(w)));
  const overlap = [...rw].filter(w => low.includes(w)).length;
  if (overlap >= 2) { score += 12; strengths.push('References specifics from the review.'); } else tips.push('Mention a specific detail from the review (a service, staff member, or issue) so it does not read like a template.');
  if (words < 12) { score -= 10; tips.push('The reply is very short. Add a sentence that shows you read the review.'); }
  else if (words > 140) { score -= 8; tips.push('Trim it. Replies over about 120 words get skimmed; aim for 3-5 sentences.'); }
  else { score += 6; strengths.push('Good length.'); }
  if (neg) {
    if (/\b(sorry|apologi[sz]e|apologies)\b/i.test(p)) { score += 10; strengths.push('Apologizes for the problem.'); } else tips.push('For a negative review, include a sincere apology for their experience.');
    if (/(call|email|reach out|contact|@|\(\d{3}\)|\d{3}[-.\s]\d{4})/i.test(p)) { score += 10; strengths.push('Moves the conversation offline.'); } else tips.push('Invite them to continue offline with a phone number or email.');
    if (/\b(but you|you should have|your fault|actually you|that'?s not true|you never|you failed|lying|liar)\b/i.test(p)) { score -= 18; tips.push('Avoid defensive or blaming language; readers side with the calm reply.'); }
  } else {
    if (/\b(again|next time|see you|soon|back)\b/i.test(p)) { score += 8; strengths.push('Invites them back.'); } else tips.push('Close with an invitation to come back.');
  }
  if (/(free|discount|% off|coupon|comp(ed|limentary)?)\b/i.test(p)) { score -= 6; tips.push('Avoid public freebies or discounts; offer make-goods privately.'); }
  if (/!{2,}|[\u{1F300}-\u{1FAFF}]|#\w/u.test(p)) { score -= 5; tips.push('Skip emojis, hashtags, and repeated exclamation marks.'); }
  if (/\b(dear valued customer|we value your feedback|thank you for your feedback\.?$)/i.test(p)) { score -= 6; tips.push('Replace stock phrases like "we value your feedback" with something specific.'); }
  if (/(diagnos|treatment|patient record|your appointment on|invoice #|account number)/i.test(p)) { score -= 6; tips.push('Do not share private details (health, invoices, account info) in a public reply.'); }
  if (/[-–—]\s*[A-Z][a-z]+/.test(p) || /\b(owner|manager|team)\s*$/i.test(p)) { score += 4; strengths.push('Signed with a name or role.'); } else tips.push('Sign with a real name and role, like "Dana, Owner".');
  score = Math.max(5, Math.min(100, Math.round(score)));
  return { score, grade: score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'F', strengths, tips: tips.slice(0, 6) };
}
module.exports = { gradeHeuristic };
