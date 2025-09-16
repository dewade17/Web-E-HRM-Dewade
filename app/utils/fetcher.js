import Cookies from "js-cookie";

export const fetcher = async (url) => {
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${Cookies.get("token")}` },
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error("Error fetching data:", error);
    throw error;
  }
};
