import { Cat, Sparkles, Target } from 'lucide-react';

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
        <h1>Your copilot for the whole job hunt.</h1>
        <p>Sox learns your real experience once, then helps you target the right roles, reach the
          right people, and tailor a truthful resume to every job — no fabrication, no keyword stuffing.</p>
        <div className="homeCards">
          <button className="homeCard" onClick={onNewResume}>
            <Target size={22} />
            <strong>New job hunt</strong>
            <span>Open a workspace for one job — research it, reach out, and tailor a resume.</span>
          </button>
          <button className="homeCard" onClick={onCopilot}>
            <Sparkles size={22} />
            <strong>Chat with your copilot</strong>
            <span>Tell it about your work, scout roles and companies, and plan your outreach.</span>
          </button>
        </div>
      </div>
    </div>
  );
}
