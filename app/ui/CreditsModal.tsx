"use client";

import { useRouter } from "next/navigation";
import { ReactNode } from "react";

export default function CreditsModal({ children }: { children: ReactNode }) {
  const router = useRouter();
  const closeModal = () => router.back();

  return (
    <div
      className="credits-modal"
      onClick={closeModal}
      role="dialog"
      aria-modal="true"
      aria-label="Credits"
    >
      <div className="credits-modal-card" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="credits-modal-close" onClick={closeModal} aria-label="Close credits">
          ×
        </button>
        {children}
      </div>
    </div>
  );
}
