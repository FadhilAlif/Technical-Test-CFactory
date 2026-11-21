import { ImageProcessorWorkspace } from '@/components/ImageProcessorWorkspace';
import { ThemeToggleBar } from '@/components/ThemeToggleBar';
import styles from '@/components/image-processor.module.css';

export default function HomePage() {
  return (
    <div className={styles.page}>
      <a href="#processor-heading" className="skip-link visually-hidden">
        Skip to main content
      </a>

      <header className={styles.header}>
        <div className={styles.headerCopy}>
          <h1 id="processor-heading" tabIndex={-1} className={styles.title}>
            Async image processor
          </h1>
          <p className={styles.subtitle}>
            Upload a JPG, PNG, or WebP image up to 20 MB. The API returns a job ID right away while an isolated worker resizes, compresses, and converts it to WebP.
          </p>
        </div>

        <ThemeToggleBar />
      </header>

      <main>
        <ImageProcessorWorkspace />
      </main>

      <footer className={styles.footer}>
        <span>Hono API delegator · BullMQ + Sharp worker · NeonDB PostgreSQL</span>
        <span>Max 20 MB · 1280px longest side · 80% WebP</span>
      </footer>
    </div>
  );
}
