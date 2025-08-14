import { Header } from "@/components/header";
import { EntryClient } from "@/components/entry-client";
import { SHOPS } from "@/lib/data";

export default function EntryPage() {
  return (
    <div className="flex h-full flex-col">
      <Header title="Daily Data Entry" shops={SHOPS} />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
        <EntryClient />
      </div>
    </div>
  );
}
