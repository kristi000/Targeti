
type HeaderProps = {
  title: string;
};

export function Header({ title }: HeaderProps) {
  return (
    <header className="sticky top-0 z-10 flex h-12 items-center border-b bg-background/80 px-4 backdrop-blur-sm md:px-5">
      <h1 className="text-lg font-semibold md:text-xl">{title}</h1>
      <div className="ml-auto flex items-center gap-4">
      </div>
    </header>
  );
}
