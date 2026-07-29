'use client';

import { useTransition } from 'react';
import { actionUploadAttachment } from '@/app/(app)/shared-services/af/actions';

export function AttachmentUploadForm({
  entityCode,
  documentType,
  displayName,
  attachmentDefaultId,
}: {
  entityCode: string;
  documentType: string;
  displayName: string;
  attachmentDefaultId?: string;
}) {
  const [pending, start] = useTransition();

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          await actionUploadAttachment(fd);
          e.currentTarget.reset();
        });
      }}
    >
      <input type="hidden" name="entityCode" value={entityCode} />
      <input type="hidden" name="documentType" value={documentType} />
      <input type="hidden" name="displayName" value={displayName} />
      {attachmentDefaultId ? (
        <input
          type="hidden"
          name="attachmentDefaultId"
          value={attachmentDefaultId}
        />
      ) : null}
      <input
        type="file"
        name="file"
        accept="application/pdf,image/png,image/jpeg"
        required
        className="max-w-[220px] text-xs"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-[#3a414f] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#535c63] disabled:opacity-50"
      >
        {pending ? 'Uploading…' : 'Upload PDF'}
      </button>
    </form>
  );
}
