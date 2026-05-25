import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "意图指针动态评测 POC",
  description: "eval-test-v1 可行性试验",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
