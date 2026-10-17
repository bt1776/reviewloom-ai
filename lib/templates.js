// Template-based fallback generator: adapts to rating, tone, length, and review content.
const POS = /\b(great|amazing|awesome|excellent|love|loved|best|friendly|fantastic|wonderful|perfect|recommend|helpful|clean|delicious|fast|professional)\b/i;
const NEG = /\b(bad|terrible|awful|rude|worst|slow|dirty|never|disappoint\w*|cold|late|wrong|horrible|overpriced|waited|ignored|broken|unprofessional)\b/i;
const TOPICS = [
  [/\b(staff|team|employee|server|waiter|waitress|tech|technician|crew)\b/i, 'our team'],
  [/\b(food|meal|dish|pizza|burger|coffee|taco|dinner|lunch|breakfast)\b/i, 'the food'],
  [/\b(service|customer service)\b/i, 'the service'],
  [/\b(price|prices|cost|expensive|overpriced|value)\b/i, 'pricing'],
  [/\b(wait|waited|slow|late|took forever|hour)\b/i, 'the wait time'],
  [/\b(clean|dirty|mess)\b/i, 'cleanliness'],
  [/\b(appointment|schedul\w*|booking)\b/i, 'scheduling'],
];
function inferRating(t) {
  const p = (t.match(new RegExp(POS, 'gi')) || []).length, n = (t.match(new RegExp(NEG, 'gi')) || []).length;
  return n > p ? (n - p > 1 ? 1 : 2) : p > n ? 5 : 3;
}
function firstName(t) { const m = t.match(/\b(?:[Tt]hanks?|[Tt]hank you|[Aa]sk for|[Ss]hout ?out to)\s+([A-Z][a-z]+)/); return m ? m[1] : null; }
const pick = (a, i) => a[i % a.length];

function generateTemplates(o) {
  const rating = o.rating || inferRating(o.review);
  const biz = o.businessName || 'our team';
  const type = o.businessType ? o.businessType.toLowerCase() : 'business';
  const topic = (TOPICS.find(([re]) => re.test(o.review)) || [null, null])[1];
  const staff = firstName(o.review);
  const band = rating >= 4 ? 'pos' : rating === 3 ? 'mid' : 'neg';
  const T = o.tone;

  const open = {
    pos: { warm: ['Thank you so much for the kind words!', 'What a lovely review to read. Thank you!', 'We truly appreciate you taking the time to share this.'],
           professional: ['Thank you for your excellent review.', 'We appreciate your feedback and your business.', 'Thank you for taking the time to share your experience.'],
           upbeat: ['Wow, thank you! This made our day!', 'Thanks a ton for the awesome review!', 'You just made the whole team smile. Thank you!'],
           apologetic: ['Thank you so much for your review.', 'We really appreciate you sharing this.', 'Thank you for the generous feedback.'] },
    mid: { warm: ['Thank you for sharing your honest feedback.', 'We appreciate you taking the time to write this.', 'Thanks for letting us know how your visit went.'],
           professional: ['Thank you for your feedback.', 'We appreciate your candid review.', 'Thank you for taking the time to share your experience.'],
           upbeat: ['Thanks for stopping by and sharing your thoughts!', 'We appreciate the honest feedback!', 'Thanks for the review. We hear you!'],
           apologetic: ['Thank you for your feedback, and we are sorry your visit was not perfect.', 'We appreciate your honesty and apologize for falling short.', 'Thank you for sharing this, and our apologies that we missed the mark.'] },
    neg: { warm: ['We are truly sorry to hear about your experience.', 'Thank you for telling us, and we are so sorry this happened.', 'We hate to hear this, and we sincerely apologize.'],
           professional: ['We apologize that your experience did not meet expectations.', 'Thank you for bringing this to our attention, and please accept our apologies.', 'We regret that your visit fell short of our standards.'],
           upbeat: ['We are really sorry this was not the experience you deserved.', 'Thanks for being honest with us. We are sorry we let you down.', 'This is not the experience we want for anyone, and we are sorry.'],
           apologetic: ['We are deeply sorry for your experience.', 'Please accept our sincere apologies.', 'We are so sorry. You deserved much better from us.'] },
  };
  const middle = {
    pos: [
      topic ? `We are thrilled to hear ${topic} stood out for you.` : `We are thrilled you had a great experience with us.`,
      staff ? `We will be sure to pass your kind words along to ${staff}.` : `Your feedback means a lot to everyone at ${biz}.`,
      `Being a ${type} our community trusts is what we work for every day.`,
    ],
    mid: [
      topic ? `We are glad parts of your visit went well, and we have noted your comments about ${topic}.` : `We are glad parts of your visit went well, and we have noted where we can improve.`,
      `Feedback like yours helps ${biz} get better.`,
      `We would love the chance to earn that fifth star next time.`,
    ],
    neg: [
      topic ? `Your comments about ${topic} have been shared with our management so we can fix this.` : `Your feedback has been shared with our management so we can make this right.`,
      `This is not the standard we hold ourselves to at ${biz}.`,
      `We would really appreciate the chance to speak with you directly and make things right.`,
    ],
  };
  const close = {
    pos: { warm: ['We cannot wait to see you again soon!', 'Hope to see you again soon.', 'Thanks again for supporting a local business!'],
           professional: ['We look forward to serving you again.', 'We look forward to your next visit.', 'Thank you for choosing us.'],
           upbeat: ['See you next time!', 'Come back soon. We will be here!', 'Cannot wait to have you back!'],
           apologetic: ['We look forward to seeing you again.', 'Thank you again, and we hope to see you soon.', 'We hope to welcome you back soon.'] },
    mid: { all: ['We hope to see you again soon.', 'Please let us know if there is anything we can do.', 'Thank you again for the feedback.'] },
    neg: { all: ['Please reach out to us directly so we can resolve this.', 'Please contact us directly. We would like to make this right.', 'We hope you will give us the opportunity to do better.'] },
  };
  const nSent = { short: 1, medium: 2, long: 3 }[o.length] || 2;
  const replies = [0, 1, 2].map(i => {
    const mids = [];
    for (let k = 0; k < nSent; k++) mids.push(middle[band][(i + k) % 3]);
    const c = close[band][T] || close[band].all;
    const parts = [pick(open[band][T], i), ...mids, pick(c, i)];
    if (o.length !== 'short' && o.businessName) parts.push(`- The ${o.businessName} Team`);
    return parts.join(' ').replace(' - The', '\n\n- The');
  });
  return { replies, rating, inferred: !o.rating };
}
module.exports = { generateTemplates };
