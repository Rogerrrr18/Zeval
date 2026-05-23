import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Zeval",
  description: "把真实 AI 对话 bad case 转成证据、调优包与验证结果的质量闭环系统。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
