import { Cat, FilePlus2, Sparkles } from 'lucide-react';

interface HomeProps {
  onNewResume: () => void;
  onCopilot: () => void;
}

// The landing pane when nothing is selected: a warm welcome with the two ways
// in — start a resume, or chat with Sox to build memory first.
export default function Home({ onNewResume, onCopilot }: HomeProps) {
  return (
    <div className="pane">
      <div className="home">
        <div className="greetingMark"><Cat size={34} /></div>
        <h1>Let's build a resume that's actually you.</h1>
        <p>Sox learns your real experience once, then tailors a truthful resume to every job —
          no fabrication, no keyword stuffing.</p>
        <div className="homeCards">
          <button className="homeCard" onClick={onNewResume}>
            <FilePlus2 size={22} />
            <strong>New resume</strong>
            <span>Paste a job description and tailor a draft from your memory.</span>
          </button>
          <button className="homeCard" onClick={onCopilot}>
            <Sparkles size={22} />
            <strong>Chat with Sox</strong>
            <span>Tell your copilot about your work to build long-term memory.</span>
          </button>
        </div>
      </div>
    </div>
  );
}
