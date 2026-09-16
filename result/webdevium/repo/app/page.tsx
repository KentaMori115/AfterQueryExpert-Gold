import { redirect } from 'next/navigation'

// Homepage redirects to dashboard if authenticated, otherwise login page handles it
export default function Home() {
  redirect('/login')
}
