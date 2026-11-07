// Replicates FlashcardsView's practice-review queue logic exactly.
import { sm2 } from './sm2.bundle.mjs';
const now = new Date();
let practiceQuestions = ['Q0','Q1','Q2'].map((id,i)=>({ id, question:id, answer:'a', type:'open', createdAt:now }));

const duePracticeQuestions = () => practiceQuestions
  .filter(q => !q.nextReview || new Date(q.nextReview) <= now)
  .sort((a,b)=> { if(!a.nextReview) return -1; if(!b.nextReview) return 1;
                   return new Date(a.nextReview).getTime()-new Date(b.nextReview).getTime(); });

let practiceReviewIdx = 0;
const current = () => duePracticeQuestions()[practiceReviewIdx % Math.max(duePracticeQuestions().length,1)];

const seen = [];
for (let step=0; step<5; step++) {
  const q = current();
  if (!q) { console.log('step',step,'-> no current question'); break; }
  seen.push(q.id);
  const srs = sm2(q, 3); // "correct"
  practiceQuestions = practiceQuestions.map(x => x.id===q.id ? {...x, ...srs, lastAnsweredCorrect:true} : x);
  const len = duePracticeQuestions().length;
  if (practiceReviewIdx + 1 >= len) { console.log('step',step,'-> SESSION COMPLETE toast; due.length =',len); break; }
  practiceReviewIdx++;
}
console.log('Questions actually shown to user:', seen.join(' -> '));
console.log('Expected (all 3): Q0 -> Q1 -> Q2');
