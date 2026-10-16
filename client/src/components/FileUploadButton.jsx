import { useRef } from 'react';
import { Paperclip } from 'lucide-react';
import toast from 'react-hot-toast';
import { IMAGE_TYPES, MAX_IMAGE_BYTES } from './CameraCaptureModal';

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
const DOC_EXT = ['.pdf', '.docx', '.xlsx', '.pptx', '.zip', '.txt', '.csv', '.md'];
export const ACCEPT = [...IMAGE_TYPES, ...DOC_EXT].join(',');

/** Client-side pre-check for fast feedback. The server re-validates the real file content. */
export function classifyFile(file) {
  if (IMAGE_TYPES.includes(file.type)) {
    if (file.size > MAX_IMAGE_BYTES) return { error: 'Images must be 10 MB or smaller' };
    return { type: 'image' };
  }
  const ext = `.${file.name.split('.').pop()?.toLowerCase()}`;
  if (!DOC_EXT.includes(ext)) return { error: 'Unsupported file type. Allowed: images, PDF, Office files, ZIP, TXT, CSV' };
  if (file.size > MAX_FILE_BYTES) return { error: 'Files must be 20 MB or smaller' };
  return { type: 'file' };
}

export default function FileUploadButton({ onFile, disabled }) {
  const ref = useRef(null);
  return (
    <>
      <button type="button" className="icon-btn h-9 w-8 sm:w-9" onClick={() => ref.current?.click()} disabled={disabled} aria-label="Attach file" title="Attach file">
        <Paperclip size={19} />
      </button>
      <input
        ref={ref}
        type="file"
        accept={ACCEPT}
        className="hidden"
        data-testid="file-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          const result = classifyFile(file);
          if (result.error) toast.error(result.error);
          else onFile(file, result.type);
        }}
      />
    </>
  );
}
