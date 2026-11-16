/**
 * DocumentBriefing — what the tutor built out of an uploaded file.
 *
 * Shown as a chat turn so the briefing is part of the conversation: the
 * student can keep asking follow-up questions ("explain point 3", "quiz me
 * on this") and the tutor stays grounded in the same document.
 */

import type { DocumentAnalysis } from '../api/ai';
import { renderAiText } from '../utils/aiText';
import KeyPointsPanel from './KeyPointsPanel';

interface Props {
  analysis: DocumentAnalysis;
}

export default function DocumentBriefing({ analysis }: Props) {
  const { overview, keyPoints, outline, glossary, questions } = analysis;

  return (
    <div className="sw-brief">
      {overview && (
        <section className="sw-brief-section">
          <h3 className="sw-brief-heading">
            <span aria-hidden="true">📘</span> What this material covers
          </h3>
          {renderAiText(overview)}
        </section>
      )}

      {keyPoints.length > 0 && (
        <section className="sw-brief-section">
          <KeyPointsPanel points={keyPoints} title="What you must know" />
        </section>
      )}

      {outline.length > 0 && (
        <section className="sw-brief-section">
          <h3 className="sw-brief-heading">
            <span aria-hidden="true">🗂️</span> How it is structured
          </h3>
          <ol className="sw-brief-outline">
            {outline.map((item, i) => (
              <li key={i}>
                <span className="sw-brief-outline-title">{item.heading}</span>
                {item.detail && <span className="sw-brief-outline-detail">{item.detail}</span>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {glossary.length > 0 && (
        <section className="sw-brief-section">
          <h3 className="sw-brief-heading">
            <span aria-hidden="true">🔤</span> Vocabulary you need
          </h3>
          <dl className="sw-brief-glossary">
            {glossary.map((g, i) => (
              <div key={i} className="sw-brief-glossary-row">
                <dt>{g.term}</dt>
                <dd>{g.meaning}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {questions.length > 0 && (
        <section className="sw-brief-section">
          <h3 className="sw-brief-heading">
            <span aria-hidden="true">❓</span> Likely exam questions
          </h3>
          <ol className="sw-brief-questions">
            {questions.map((q, i) => <li key={i}>{q}</li>)}
          </ol>
        </section>
      )}
    </div>
  );
}
