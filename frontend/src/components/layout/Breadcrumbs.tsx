import { useLocation, Link } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";
import { cn } from "@/lib/utils";

const ROUTE_LABELS: Record<string, string> = {
  "": "Insights",
  data: "Data Sources",
  query: "Query",
  dashboards: "Dashboards",
  reports: "Reports",
  settings: "Settings",
};

export const Breadcrumbs = ({ className }: { className?: string }) => {
  const { pathname } = useLocation();
  const segments = pathname.split("/").filter(Boolean);

  // Don't show breadcrumb on root
  if (segments.length === 0) return null;

  const crumbs = [
    { label: "Home", path: "/" },
    ...segments.map((seg, idx) => ({
      label: ROUTE_LABELS[seg] || seg.charAt(0).toUpperCase() + seg.slice(1),
      path: "/" + segments.slice(0, idx + 1).join("/"),
    })),
  ];

  return (
    <nav
      aria-label="Breadcrumb"
      className={cn("flex items-center gap-1 text-[11px] text-muted-foreground", className)}
    >
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={crumb.path} className="inline-flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-3 w-3 text-border" />}
            {isLast ? (
              <span className="font-medium text-foreground">{crumb.label}</span>
            ) : i === 0 ? (
              <Link
                to={crumb.path}
                className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
              >
                <Home className="h-3 w-3" />
                <span className="sr-only">{crumb.label}</span>
              </Link>
            ) : (
              <Link
                to={crumb.path}
                className="hover:text-foreground transition-colors"
              >
                {crumb.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
};
