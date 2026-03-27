/**
 * Layout override for /share/[token] — completely covers the broker app shell
 * so GlobalNav and ActiveClientProvider context are not visible to the client.
 */
export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-white">
      {children}
    </div>
  );
}
