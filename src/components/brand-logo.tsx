import { cn } from "@/lib/utils";

export function BrandLogo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-2.5 text-[#64308f] dark:text-[#b991db]", className)}>
      <span
        aria-hidden="true"
        className="h-10 w-10 shrink-0 bg-current [mask-image:url('/branding/d-one-mark.svg')] [mask-repeat:no-repeat] [mask-size:contain]"
      />
      <span className="text-2xl font-bold tracking-tight">D-one</span>
    </span>
  );
}
