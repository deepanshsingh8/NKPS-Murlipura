import { Metadata } from "next";
import { StudentLifeContent } from "./StudentLifeContent";
import { JsonLd } from "@/components/seo/JsonLd";
import { getSectionCards } from "@/lib/site-media";
import { buildMetadata, breadcrumbJsonLd } from "@nkps/shared/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Student Life & Activities — NK Public School Jaipur",
  description:
    "Co-curricular life at NK Public School, Jaipur — music, dance, art, debate, quiz, literary and science clubs plus annual events that shape character beyond the classroom.",
  path: "/student-life",
});

export const revalidate = 60;

export default async function StudentLifePage() {
  const [activityCards, eventCards, sportsIndoorCards, sportsOutdoorCards] =
    await Promise.all([
      getSectionCards("activities"),
      getSectionCards("annual_events"),
      getSectionCards("sports_indoor"),
      getSectionCards("sports_outdoor"),
    ]);

  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Student Life", path: "/student-life" },
        ])}
      />
      <StudentLifeContent
        activityCards={activityCards}
        eventCards={eventCards}
        sportsIndoorCards={sportsIndoorCards}
        sportsOutdoorCards={sportsOutdoorCards}
      />
    </>
  );
}
