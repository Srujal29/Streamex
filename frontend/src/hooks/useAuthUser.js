import { useQuery } from "@tanstack/react-query";
import { getAuthUser } from "../lib/api";

const useAuthUser = () => {
  const { data, isLoading: queryLoading } = useQuery({
    queryKey: ["authUser"],
    queryFn: getAuthUser,
    retry: false,
  });

  const authUser = data?.user
    ? {
        ...data.user,
        profilePic:
          data.user.profilePic && data.user.profilePic !== ""
            ? data.user.profilePic
            : "/default-avatar.png",
      }
    : null;

  return { authUser, isLoading: queryLoading };
};

export default useAuthUser;
