import { api } from '../api.ts';
import type { ResumeVersion } from '../../shared/types.ts';

// Live preview of the actual exported PDF. Embedding the real document (rather
// than an HTML approximation) means the preview is page-for-page identical to
// what the user downloads — same template, same pagination, same length.
export default function ResumePreview({ version }: { version: ResumeVersion }) {
  if (!version) return null;
  // Key by id+template so the iframe reloads whenever the content (new version)
  // or template changes.
  const src = `${api.previewUrl(version.id, version.template_id)}#toolbar=0&navpanes=0&statusbar=0&view=FitH`;
  return (
    <div className="previewFrameWrap">
      <iframe
        key={`${version.id}:${version.template_id}`}
        className="previewFrame"
        src={src}
        title="Resume preview"
      />
    </div>
  );
}
