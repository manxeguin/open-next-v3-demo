import styles from "./page.module.css";
import { headers } from "next/headers";

export default function Home() {
  const headersList = headers();
  const injectedHeader = headersList.get("x-inserted-in-converter");
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <ol>
          <li>Injected header: {injectedHeader}</li>
        </ol>
      </main>
    </div>
  );
}
