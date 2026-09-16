# Webdevium Dashboard

A modern, lightweight dashboard for managing client development projects and tasks.

## Tech Stack

- **Framework**: Next.js 15 with App Router + TypeScript
- **Styling**: Tailwind CSS
- **UI Components**: shadcn/ui (Radix primitives) + Lucide React icons
- **State Management**: React Hook Form + Zod (planned)
- **Tables**: TanStack Table (planned)
- **Charts**: Recharts (planned)
- **Auth/DB**: Supabase (planned)
- **Payments**: Stripe (planned)
- **Email**: Resend (planned)
- **File Storage**: Cloudinary (planned)

## Features Implemented

### ✅ Core Layout
- **AdminKit-inspired layout** with fixed left sidebar, top bar, and content area
- **Responsive design** with mobile-friendly sidebar that collapses to a sheet
- **Clean, modern UI** using shadcn/ui components

### ✅ Client Dashboard
- **Plan badge** showing current subscription tier
- **Usage meter** with visual progress bar and status indicators (On Track/Approaching/Exceeded)
- **Stats cards** displaying tasks completed, average turnaround, and plan info
- **Recent activity feed** showing latest task updates
- **Action buttons** for submitting new tasks and managing billing
- **Upgrade nudges** when usage approaches 80%

### ✅ Client Tasks Board
- **Kanban layout** with three columns: Queued, In Progress, Done
- **Task cards** showing title, description, priority, attachments, and dates
- **Priority badges** with color coding (High/Medium/Low)
- **Task metadata** including creation dates and assigned developers
- **Responsive grid** that stacks on mobile devices

### ✅ Additional Pages
- **Billing page** with subscription details and invoice history
- **Settings page** for profile management
- **Navigation** with active state indicators

## Getting Started

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Run the development server**:
   ```bash
   npm run dev
   ```

3. **Open your browser** and navigate to `http://localhost:3000`

## Project Structure

```
├── app/                    # Next.js App Router pages
│   ├── dashboard/         # Client dashboard
│   ├── tasks/            # Task management
│   ├── billing/          # Billing & subscriptions
│   └── settings/         # Account settings
├── components/
│   ├── layout/           # Layout components (sidebar, topbar)
│   └── ui/              # shadcn/ui components
├── lib/
│   └── utils.ts         # Utility functions
└── public/              # Static assets
```

## Next Steps (Planned)

- [ ] **Supabase Integration**: Database schema, authentication, RLS
- [ ] **Task Management**: Drag-and-drop reordering, task creation modal
- [ ] **Admin Views**: Client management, task assignment, usage tracking
- [ ] **Real-time Updates**: Task status changes, notifications
- [ ] **Billing Integration**: Stripe subscriptions, usage-based billing
- [ ] **Email Notifications**: Task updates, billing reminders

## Design Principles

- **Mobile-first responsive design**
- **Consistent component usage** from shadcn/ui
- **Clean, minimal interface** focused on functionality
- **Progressive enhancement** with skeleton loaders and optimistic updates
- **Accessible** with proper ARIA labels and keyboard navigation

---

The dashboard is ready for development and can be extended with backend integration, real-time features, and advanced task management capabilities.
