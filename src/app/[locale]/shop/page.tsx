import { redirect } from "next/navigation";

export default function ShopIndexPage() {
  // Redirect to the main dashboard since this route shouldn't be accessed directly
  redirect('/en');
}

