import Link from "next/link";

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <Link href="/credits" className="site-footer-link">
        Credits
      </Link>
    </footer>
  );
}
