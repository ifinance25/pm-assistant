import type { UserRole } from "../shared/types.ts";

export type AppEnv = {
  Variables: {
    userId: string;
    userRole: UserRole;
  };
};
