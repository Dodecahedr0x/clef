import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './icons';

/**
 * A full-screen picker over the current screen: a native modal `<dialog>`, so focus moves into it and stays there,
 * the page behind is inert, and Escape closes it. Focus returns to what opened it.
 */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const dialog = ref.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    // Escape: the browser fires `cancel`; close through React so the parent's state stays the source of truth.
    const onCancel = (e: Event) => {
      e.preventDefault();
      close.current();
    };
    dialog.addEventListener('cancel', onCancel);
    if (!dialog.contains(document.activeElement)) dialog.querySelector<HTMLElement>('input, button')?.focus();
    return () => {
      dialog.removeEventListener('cancel', onCancel);
      if (dialog.open && typeof dialog.close === 'function') dialog.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onKeyDown={(e) => {
        // jsdom and older engines without showModal: Escape still closes.
        if (e.key === 'Escape' && typeof ref.current?.showModal !== 'function') close.current();
      }}
      className="fixed inset-0 m-0 flex h-full max-h-none w-full max-w-none flex-col border-0 bg-bg p-0 text-ink backdrop:bg-transparent"
    >
      <div className="h-14 px-4 flex flex-none items-center border-b border-line-soft">
        <h2 className="m-0 text-[18px] font-semibold">{title}</h2>
        <button type="button" aria-label="Close" onClick={onClose} className="ml-auto w-11 h-11 flex items-center justify-center bg-transparent border-0">
          <Icon name="close" size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
