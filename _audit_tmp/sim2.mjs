// Replicates FlashcardsView's spaced-review queue logic exactly (rateCard path).
import { sm2 } from './sm2.bundle.mjs';
const now = new Date();
let flashcards = ['F0','F1','F2'].map(id=>({ id, question:id, answer:'a', createdAt:now }));

const dueCards = () => flashcards.filter(c => !c.nextReview || new Date(c.nextReview) <= now);
const reviewCards = () => { const d = dueCards(); return d.length > 0 ? d : flashcards; };
let reviewIndex = 0;
const currentCard = () => reviewCards()[reviewIndex % Math.max(reviewCards().length,1)];

const seen = [];
for (let step=0; step<6; step++) {
  const c = currentCard();
  if (!c) { console.log('step',step,'-> no card'); break; }
  seen.push(c.id);
  const srs = sm2(c, 3);
  flashcards = flashcards.map(x => x.id===c.id ? {...x, ...srs} : x);
  const len = reviewCards().length;
  console.log(`step ${step}: showed ${c.id}; queue length now ${len}`);
  if (reviewIndex + 1 >= len) { console.log('  -> SESSION COMPLETE toast'); break; }
  reviewIndex++;
}
console.log('Cards actually shown:', seen.join(' -> '));
console.log('Expected: F0 -> F1 -> F2');
