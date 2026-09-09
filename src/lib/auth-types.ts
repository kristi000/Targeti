export type AppRole = "admin" | "editor" | "viewer";

export type AppActor = {
  id: string;
  username: string;
  name: string;
  role: AppRole;
};
