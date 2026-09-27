/**
 * What each ERP screen is for, and how to actually do things on it.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * The in-app guide answers "how do I add a new student?" A model has no
 * knowledge of this ERP, and route names alone only get as far as
 * "go to People → Students" — which is the part the user had already worked
 * out. The useful half is "then Add Student, top right; you need a class to
 * exist first or the Class dropdown is empty".
 *
 * A help assistant that invents a button label is worse than no help assistant.
 * It sends someone hunting for a control that does not exist, and it poisons
 * trust in every other answer. So every label here is quoted from the JSX, and
 * `pnpm run check:guide` (scripts/check-guide-coverage.mjs) fails when a
 * sidebar route has no entry — a screen that ships without guidance should be a
 * build error, not a shrug at runtime. It runs in CI alongside lint and
 * typecheck.
 *
 * ── Keep it honest ──────────────────────────────────────────────────────────
 * `gotcha` is the highest-value field and the one that decays fastest. It is
 * for things that fail SILENTLY: a control that does nothing until something
 * else is configured, a default that surprises, a save that looks applied and
 * is not. If you change one of those behaviours, change the line here in the
 * same commit.
 */

export interface GuideTask {
  /** Imperative and short: "Record a fee payment". */
  name: string;
  /** Ordered UI actions, quoting real control labels. */
  steps: string[];
  /** What must already exist. Omit when nothing does. */
  needs?: string;
  /** What fails silently or surprises. The most useful field here. */
  gotcha?: string;
  /** Hidden from editors. The guide must not send them looking for it. */
  adminOnly?: boolean;
}

export interface ScreenGuide {
  /** Route, without query string. Matched longest-prefix-first. */
  path: string;
  /** As it reads in the sidebar. */
  title: string;
  /** One sentence. Shown in the cached index, so keep it tight. */
  purpose: string;
  tasks: GuideTask[];
  /** Paths a user needs next, or needed first. */
  related?: string[];
}

export const SCREEN_GUIDES: ScreenGuide[] = [
  // ── Dashboard ─────────────────────────────────────────────────────────────
  {
    path: "/",
    title: "Dashboard",
    purpose:
      "At-a-glance overview: count tiles, analytics panels and upcoming events.",
    tasks: [
      {
        name: "Jump to a records area",
        steps: [
          "Click one of the four tiles — Total Users, Students, Staff, Pending Registrations.",
          "Each links straight to its list.",
        ],
        gotcha:
          "A tile you cannot see means you do not hold that feature grant, not that the number is zero.",
      },
      {
        name: "Read the analytics",
        steps: [
          "Scroll to Analytics.",
          "Panels: Attendance for the month, Fee Collection, Enrolment by Class, Admissions & Exits, Transport.",
          "Click a day column in the attendance panel to inspect that day.",
        ],
        gotcha:
          "There is no date-range picker — attendance is fixed to this month and Admissions & Exits to the last six months.",
      },
      {
        name: "Read the Fee Collection panel",
        steps: [
          "The percentage measures what has been settled against fees that have already fallen due — not against the whole session.",
          "Settled and Outstanding dues add up to that same 'due so far' figure, so the two always reconcile.",
          "'Cash banked' below is the separate question of money received: it includes fees paid ahead of schedule and excludes anything waived.",
          "Paid / Remaining / Total open the Dues register filtered to that group.",
        ],
        gotcha:
          "A waiver clears a family's dues without banking any cash, and an advance banks cash against a fee not yet raised — which is why the cash figure and the settled figure differ. The panel counts only students actively enrolled this session, so a leaver's receipts are not in either.",
      },
    ],
    related: ["/people/students", "/calendar"],
  },

  // ── People ────────────────────────────────────────────────────────────────
  {
    path: "/administration/users",
    title: "Users & Access",
    purpose:
      "ERP and portal logins: create accounts, set roles, grant editor permissions, and approve registration requests.",
    tasks: [
      {
        name: "Add a user",
        steps: [
          'Click "Add User" (top right).',
          'Fill "Full Name", "Email", "Phone (optional)".',
          'Pick a "Role" — admin, staff, teacher, student or parent.',
          'Leave "Password" blank to auto-generate.',
          'Click "Create User" — the success dialog shows the temporary password with a copy button.',
        ],
        gotcha:
          'The "Add User" button is hidden while the Registrations tab is open. If the welcome email fails you must copy the password out of that dialog yourself.',
      },
      {
        name: "Reset someone's password",
        steps: [
          "Find the row using the search box or a role tab.",
          'Click "Reset password" and confirm.',
          "Copy the temporary password from the dialog and hand it over.",
        ],
        adminOnly: true,
        gotcha:
          "This does not depend on email, so it is the way in when reset links are not arriving. Their old password stops working the moment you confirm, the temporary one is shown once and never again, and they are forced to set their own at next login. You cannot reset your own password here — use Change Password instead.",
      },
      {
        name: "Change someone's role",
        steps: [
          "Find the row using the search box or a role tab.",
          "Click the coloured role badge in the Role column — it is a dropdown.",
          "Choose the new role.",
        ],
        gotcha: "It saves immediately. There is no confirm step.",
      },
      {
        name: "Grant editor permissions",
        steps: [
          'Click "Permissions" on the row.',
          'Tick features under the "CMS" and "ERP" groups.',
          'Click "Save Permissions".',
        ],
        needs:
          'The account\'s role must already be staff or teacher — the "Permissions" button only appears on those rows.',
        gotcha:
          "User management and master config stay admin-only. No grant can open those.",
      },
      {
        name: "Link a student or parent login to a student record",
        steps: [
          'Click "Link record" on the row (reads "Re-link" if already linked).',
          'Type the admission number and click "Verify".',
          "For a parent, choose the relationship.",
          'Click "Link account".',
        ],
        gotcha:
          '"Link account" stays disabled until Verify succeeds. The button only exists on student and parent rows.',
      },
      {
        name: "Approve or reject a registration request",
        steps: [
          'Open the "Registrations" tab — the badge shows the pending count.',
          "Use the Pending / Approved / Rejected / All sub-tabs.",
          'Click "Approve" to create the account and email the login, or "Reject" with an optional reason.',
        ],
        gotcha:
          "Approval can raise a link warning when the new account could not be tied to a student record — you then have to use Link record yourself.",
      },
      {
        name: "Fix broken account links",
        steps: [
          'Look for the amber "Account link health" card above the table.',
          "Click it to expand.",
          'Click "Fix" on repairable rows.',
        ],
        gotcha:
          "The card only appears when problems exist. Only two categories are repairable; the rest must be fixed by hand.",
      },
    ],
    related: ["/people/students", "/people/staff"],
  },
  {
    path: "/registrations",
    title: "Registrations",
    purpose:
      "Redirects to the Users page with its Registrations tab already open.",
    tasks: [
      {
        name: "Handle a registration request",
        steps: [
          'Click "Registrations" in the sidebar — you land on Users with the Registrations tab selected.',
          "Approve or reject from there.",
        ],
        gotcha:
          "There is no standalone registrations screen. Anything described as \"the Registrations page\" is really a tab on Users.",
      },
    ],
    related: ["/administration/users"],
  },
  {
    path: "/people/students",
    title: "Students",
    purpose:
      "The student roster for one academic session — add, edit, bulk import, promote, create logins, manage alumni.",
    tasks: [
      {
        name: "Add a student",
        steps: [
          'Click "Add Student" (top right).',
          'Fill the "General Profile" section — Full Name is required.',
          'Open "Enrolment Profile" and set "Admission No", "Admission Date" and "Class *".',
          'Click "Add Student" in the dialog footer.',
        ],
        needs:
          "At least one class must exist, or the Class dropdown is empty. Create classes under Academics → Classes first.",
        gotcha:
          "The form is two collapsible sections, so a required field can be hidden inside a collapsed one. Stream only appears for XI and XII, and locks itself when the class is already stream-bound.",
      },
      {
        name: "Edit a student",
        steps: [
          "Click the row to open the read-only detail dialog.",
          'Use "Edit" in its footer, or click the pencil icon on the row directly.',
          'Click "Update Student".',
        ],
        gotcha:
          "In a past session the pencil becomes a lock. Only an admin can open it, and it demands a written reason before Unlock & edit enables.",
      },
      {
        name: "Work in a different academic session",
        steps: [
          "Use the session dropdown in the page bar.",
          'Pick a year — the current one is marked "(current)".',
        ],
        gotcha:
          "A past session is read-only behind an amber banner. A future session lists only students already enrolled for next year.",
      },
      {
        name: "Bulk-import students from Excel",
        steps: [
          'Open the "Actions" dropdown → "Upload Excel".',
          'Click "Download Template" first.',
          "Choose your file and set the import session if needed.",
          'Review the preview, then click "Import N Students".',
        ],
        needs: 'Only "Admission No", "Name" and "Class" are required columns. Missing classes are created automatically.',
        gotcha:
          "Re-uploading an existing admission number UPDATES that student. A blank cell clears the value; a missing column is left alone.",
      },
      {
        name: "Mark a student as Exited or Terminated",
        steps: [
          'Change the row\'s Status to "Exited" or "Terminated" — a dialog opens.',
          'Set "Last day on the roll" — today by default; back-date it if the paperwork lagged.',
          "Type the reason (at least 5 characters).",
          'Click "Mark as Exited".',
        ],
        needs:
          "Both fields are required. For several students at once, tick their rows and use the bulk Status control — they share one date and one reason.",
        gotcha:
          "The date is what stops their fees. Instalments falling due AFTER it are never charged, so the student drops out of the arrears register instead of collecting a new quarter every term. Instalments already due by that date still stand and remain collectable.",
      },
      {
        name: "Fix the leaving date of a student who already left",
        steps: [
          "Find them — the Exited and Terminated tabs list the leavers.",
          "Click the date next to their status badge in the Status column.",
          "Set the correct last day on the roll, add a note if it helps, and save.",
        ],
        gotcha:
          "Students who left before leaving dates were recorded got one filled in automatically — from their TC where it fits the session, otherwise from the day the exit was typed in. Where the paperwork lagged, that is later than the truth and the student is still carrying fees they never owed, so it is worth checking. A student showing an amber \"Set date\" instead of a date has none on record and is still being billed to today. Changing the date does not change their status, and their original leaving reason is kept.",
      },
      {
        name: "Promote a class to the next year",
        steps: [
          "Pick a class in the class dropdown — the menu item only appears once one is selected.",
          'Open "Actions" → "Promote Class".',
          'Choose "Promote to Academic Year *" and click "Promote Students".',
        ],
        needs:
          "A target academic year must exist, and NO student in the class may still be active — mark everyone passed, failed, terminated or exited first.",
        gotcha:
          "Class XII passers become alumni. Failed students are re-enrolled in the same class. Terminated and exited students are skipped.",
      },
      {
        name: "Create portal logins for several students",
        steps: [
          "Tick the row checkboxes.",
          'Click "Create Users" in the blue bar.',
        ],
        adminOnly: true,
        gotcha:
          "The header checkbox selects every student matching the current filters, not just the visible page.",
      },
    ],
    related: ["/academics/classes", "/academics/years", "/administration/users", "/fees/payments"],
  },
  {
    path: "/people/staff",
    title: "Staff",
    purpose:
      "The staff directory, split into three tabs — Teachers, Management & Office, and Drivers & Helpers — with categories, contact details, photos, portal logins, and the teacher records that make someone selectable in every class, subject and timetable dropdown.",
    tasks: [
      {
        name: "Add a staff member",
        steps: [
          "Pick the tab the person belongs on (Teachers, Management & Office, or Drivers & Helpers).",
          'Click "Add Staff".',
          'Fill "Full Name *", "Subject / Designation *" and "Category *".',
          "Add email, phone, qualifications and photo if you have them.",
          "Save.",
        ],
        gotcha:
          "Category drives what happens next: bus drivers and peons cannot be given a portal login at all. The category dropdown only offers categories for the tab you are on.",
      },
      {
        name: "See a staff member's full details",
        steps: [
          "Click the person's name in the table.",
        ],
        gotcha:
          "For a converted teacher the view also lists their employee ID, joining date, the subjects they can teach, and this year's class-teacher and subject assignments. Use the Edit button in the view (or the pencil on the row) to change anything.",
      },
      {
        name: "Create a portal login for a staff member",
        steps: [
          "Find the row and click the green person-plus icon.",
          "Accept the confirm — it names the email the credentials go to.",
        ],
        adminOnly: true,
        needs:
          "The row must have an email and a login-eligible category. Without an email the cell reads \"No email\" instead.",
        gotcha:
          "A green tick means the login already exists. Editors do not see this control at all.",
      },
      {
        name: "Make someone selectable as a class or subject teacher",
        steps: [
          "Click the blue graduation-cap icon on the row (Convert to teacher).",
        ],
        needs: "The category must be a teaching category and they must not already be linked.",
        gotcha:
          "This is the step people miss. Until a staff member is converted to a teacher record they do not appear in the Class Teacher or subject-teacher dropdowns anywhere.",
      },
      {
        name: "Find someone who has been deactivated",
        steps: ['Tick "Show inactive".'],
        gotcha:
          "The list shows only active staff until you do. That is also the only way to reach a deactivated person's row — and the only way the Active column ever prints \"No\".",
      },
      {
        name: "Retire a teacher who has left the school",
        steps: [
          'Open the "Teachers" tab.',
          'Find them and click "Retire" in the Teacher record column.',
          "Confirm.",
        ],
        gotcha:
          "There is no Delete, deliberately. Deleting a teacher who has ever been timetabled fails outright, and would erase who taught what. Retiring keeps the history and takes them out of every Class Teacher, subject-teacher and timetable dropdown at once.",
      },
      {
        name: "Bring a retired teacher back",
        steps: [
          'On the "Teachers" tab, find the row showing "Retired".',
          'Click "Bring back".',
        ],
        gotcha:
          "The date of leaving is kept on purpose, so a rejoin stays visible in the record.",
      },
      {
        name: "Clear the amber “no staff profile” banner",
        steps: [
          'Click "Review them" on the banner above the Teachers tab.',
          "For each name: retire them if they have left, or add them back under Staff if they still work here — the records re-link by themselves.",
        ],
        needs:
          "The banner only appears when an active teacher record has no staff profile behind it.",
        gotcha:
          "These are the residue of deleting people from Staff before the cascade existed: the staff row went, the teacher row stayed active, and it kept appearing in dropdowns where nobody could see it to fix it. Deleting a staff member now retires their teacher record automatically, so the list should not grow.",
      },
      {
        name: "Bulk-upload staff",
        steps: [
          'Open "Actions" → "Upload Excel".',
          'Click "Download Template", fill it, choose the file.',
          "If the sheet has no Category column, pick one for the whole batch on the preview step.",
        ],
        gotcha:
          "Without a Category column every imported row lands in the single category you pick — there is no per-row override at that point.",
      },
    ],
    related: ["/administration/users", "/academics/classes", "/timetable", "/transport/buses"],
  },
  // ── Academics ─────────────────────────────────────────────────────────────
  {
    path: "/academics",
    title: "Academics",
    purpose:
      "Hub page for the structural setup of the school year — a tile each for Classes, Subjects & Assignments, Class XI–XII Electives and Academic Years.",
    tasks: [
      {
        name: "Open an academics area",
        steps: [
          "Click a tile.",
        ],
        gotcha:
          "Tiles are filtered to your grants. Set up in order — an Academic Year has to exist before Classes are useful, and Classes before Subjects can be assigned.",
      },
    ],
    related: ["/academics/years", "/academics/classes", "/academics/subjects"],
  },
  {
    path: "/academics/classes",
    title: "Classes",
    purpose:
      "Class-section rows for an academic year, with stream, class teacher and roll-number generation.",
    tasks: [
      {
        name: "Add a class",
        steps: [
          'Click "Add Class".',
          'Pick "Class Name" and "Section".',
          "For XI or XII, pick a stream — the field only appears for those two.",
          'Pick "Academic Year" and optionally "Class Teacher (optional)".',
          "Submit.",
        ],
        needs:
          "An academic year must exist. Streams come from Academics → Subjects → Streams. The teacher list only shows staff who have been converted to teacher records.",
        gotcha:
          "Changing Class Name away from XI or XII silently clears the stream you picked.",
      },
      {
        name: "Generate roll numbers",
        steps: [
          "Click the amber list icon on the row.",
          'Choose "Sort By" — name, admission number, or previous result rank.',
          'Click "Confirm".',
        ],
        gotcha:
          "This reassigns roll numbers for every active student in the class. Students with manual overrides keep theirs.",
      },
    ],
    related: ["/academics/years", "/academics/subjects", "/people/staff", "/people/students"],
  },
  {
    path: "/academics/subjects",
    title: "Subjects & Assignments",
    purpose:
      "The subject catalogue, the class-to-subject-to-teacher assignment table, the stream and wing master, and which subjects each teacher is qualified to teach.",
    tasks: [
      {
        name: "Add a subject",
        steps: [
          'On the "Subjects" tab click "Add Subject".',
          'Fill "Subject Name", "Subject Code" and "Nickname".',
          "Pick a category: Languages, Academic Subjects or Co-curricular Subjects.",
          'Tick "Elective subject" if it is one, then "Create Subject".',
        ],
        gotcha:
          "The chips above the table filter by category — a subject you just created may be hidden behind an active chip.",
      },
      {
        name: "Set up the whole CBSE curriculum at once",
        steps: [
          'On the "Subjects" tab click "Quick Setup".',
          "Review the proposed subjects, then the proposed class assignments.",
          'Click "Run Setup".',
        ],
        needs: "Classes should exist first, or there is nothing to assign to.",
        gotcha:
          "Existing rows are skipped, never overwritten. Run Setup is disabled when nothing new would be created.",
      },
      {
        name: "Set up all of a class's subjects at once",
        steps: [
          'On the "Class Assignments" tab, click the class in the "Manage by class" strip. Amber on a card means one of that class\'s subjects has no teacher.',
          "Tick every subject the class studies — each category has a Select all.",
          "Set the teacher beside each ticked subject.",
          'Click "Save subjects".',
        ],
        gotcha:
          "The teacher list puts the subject's own teachers first, under a \"Teaches …\" heading, from the Teacher Subjects tab. If nobody is mapped to that subject yet it lists everyone instead. Either way \"Show all teachers\" is there when you need someone outside their usual subject.",
      },
      {
        name: "Remove a subject from a class",
        steps: [
          'Open the class from "Manage by class", untick the subject, and save.',
        ],
        gotcha:
          "A subject with marks already recorded for that class is kept, and the dialog says which and why — removing it would leave those marks attached to a subject the class no longer studies. Everything else in the same save still goes through. Deactivate the subject instead if it is genuinely gone.",
      },
      {
        name: "Change the teacher on one assignment",
        steps: [
          'On "Class Assignments", click the teacher name in the row.',
          "Pick the teacher and save.",
        ],
        gotcha:
          "The whole cell is the control, but the pencil only appears on hover, so it does not look clickable. This picker also puts the subject's own teachers first.",
      },
      {
        name: "Create a stream and choose its subjects",
        steps: [
          'Open the "Streams" tab and click "Add Stream".',
          "Fill the name and code, save.",
          'Click "Manage" on the stream card.',
          'Tick subjects, and click the "Compulsory"/"Elective" pill on a ticked row to change its type.',
          'Click "Save".',
        ],
        needs: "Active subjects must exist first.",
        gotcha:
          "Streams are the XI/XII kind — Science, Commerce, Humanities. They appear in the Classes stream picker and can carry their own fee rows. For a band of classes that just share subjects, make a Wing instead.",
      },
      {
        name: "Set up a wing so a whole band of classes gets its subjects",
        steps: [
          'On the "Streams" tab click "Add Wing".',
          'Name it (e.g. "Middle Wing") and tick the classes it covers — each shows how many sections exist this year.',
          'Save, then click "Manage" on the wing card and tick its subjects.',
          'Click "Apply subjects to classes" and review the preview.',
          "Confirm.",
        ],
        needs:
          "The classes must already exist for this academic year, and the wing must have at least one subject.",
        gotcha:
          "This is additive — it never removes a subject and never overwrites a teacher already set on an existing assignment, so re-running it on a band you have part-staffed is safe. The preview tells you how many rows are new and how many are already there.",
      },
      {
        name: "Understand why a wing is not a stream",
        steps: [
          'Both live on the "Streams" tab, in separate sections.',
        ],
        gotcha:
          "A wing never appears in the XI/XII stream picker, the fee-schedule stream filter, the student enrolment form or a report filter — it is only a shortcut for allotting subjects. That separation is deliberate: fee resolution reads a student's stream, so a wing loose in there would change what families are charged. You also cannot convert one into the other; delete and recreate.",
      },
      {
        name: "Record which subjects a teacher can teach",
        steps: [
          'Open the "Teacher Subjects" tab.',
          'Find the teacher and click "Manage".',
          "Tick every subject they are qualified to teach, then Save.",
        ],
        gotcha:
          "This is what makes the teacher dropdown on Class Assignments put the right people first \u2014 pick Mathematics and the maths teachers come to the top. It is not the same as assigning them to a class; that is still the Class Assignments tab.",
      },
      {
        name: "Find every teacher who can take a subject",
        steps: [
          'On the "Teacher Subjects" tab, set "Teaches subject" to the one you want.',
        ],
        gotcha:
          'Pick "No subjects yet" in the same dropdown to find teachers nobody has mapped, which is where the Class Assignments dropdown will fall back to listing everyone.',
      },
    ],
    related: ["/academics/classes", "/academics/electives", "/people/staff"],
  },
  {
    path: "/academics/electives",
    title: "XI–XII Electives",
    purpose:
      "The two elective slots for classes XI and XII — which subjects are offered, and each student's choice.",
    tasks: [
      {
        name: "Offer a subject in an elective slot",
        steps: [
          'Pick "Class XI" or "Class XII".',
          'Expand "Subjects offered to class XI/XII".',
          'In the "Elective 5" or "Elective 6" panel pick a subject and click "Add".',
        ],
        gotcha:
          "XI and XII keep separate lists — adding to one does not add to the other.",
      },
      {
        name: "Set a student's elective",
        steps: [
          'Scroll to "Class XI/XII students".',
          'Pick a subject in the row\'s "Elective 5" or "Elective 6" dropdown.',
          "It saves on selection — the cell shows a green tick.",
        ],
        needs: "The slot must have at least one option, or the picker reads \"No class X options\".",
        gotcha:
          "A choice made before the XI/XII lists were split shows an amber border and reads \"no longer offered\" — re-pick it.",
      },
      {
        name: "Set the same elective for many students",
        steps: [
          "Tick the row checkboxes.",
          'In the blue bar pick "Slot" and "Set to".',
          'Click "Apply to N".',
        ],
        gotcha: 'Changing "Slot" resets the subject you had chosen.',
      },
      {
        name: "Find students who have not chosen",
        steps: [
          'Click the "Still incomplete" tile to filter the table down to them.',
          "Click it again to clear the filter.",
        ],
      },
    ],
    related: ["/academics/subjects", "/people/students"],
  },
  {
    path: "/academics/years",
    title: "Academic Years",
    purpose:
      "The session master — create academic years, mark the current one, and see each year's totals.",
    tasks: [
      {
        name: "Add an academic year",
        steps: [
          'Click "Add Academic Year".',
          'Fill "Name" (e.g. 2025-26), "Start Date" and "End Date".',
          "Save.",
        ],
        gotcha: "All three fields are required.",
      },
      {
        name: "Make a year the current session",
        steps: ['Click "Set Current" on the row.'],
        gotcha:
          "This changes the default session for every year-scoped page across the whole ERP.",
      },
      {
        name: "Delete a year",
        steps: ["Click the red trash icon and accept the confirm."],
        gotcha:
          "You cannot delete the current year — make another current first. A year that has records filed under it is refused outright; it is the historical record.",
      },
    ],
    related: ["/people/students", "/academics/classes"],
  },
  {
    path: "/academics/houses",
    title: "Houses",
    purpose:
      "The inter-house master. A student's house is recorded per session on their enrolment.",
    tasks: [
      {
        name: "Add a house",
        steps: [
          'Click "Add House".',
          'Fill "Name *" and "Code".',
          'Pick a "Colour", set "Sort Order", leave "Active" ticked.',
          'Click "Add House".',
        ],
        gotcha: "Names are unique regardless of case.",
      },
      {
        name: "Retire a house",
        steps: [
          "Open the row's edit dialog.",
          'Untick "Active".',
        ],
        gotcha:
          "Prefer this to deleting. Deleting clears the house on every student's enrolment in every session.",
      },
    ],
    related: ["/people/students"],
  },

  // ── Calendar & attendance ────────────────────────────────────────────────
  {
    path: "/class-diary",
    title: "Class Diary",
    purpose:
      "Post homework, holiday homework, notices, fee reminders and photos to classes or the whole school; families read them in their portal.",
    tasks: [
      {
        name: "Post to one or more classes",
        steps: [
          'Click "New Post".',
          'Pick a Type: "Homework", "Holiday Homework", "Notice", "Fee Reminder" or "Photos".',
          "Tick the classes under Classes, or tick \"Whole school (every family)\".",
          'Fill "Title" and "Details". For homework, optionally set "Submit by (optional)".',
          'Optionally click "Attach photos or PDFs".',
          'Click "Post".',
        ],
        gotcha:
          "Ticking several classes makes one copy per class, so editing or deleting one class's copy leaves the others. The Subject picker only appears when exactly one class is ticked.",
      },
      {
        name: "See who has read a post",
        steps: [
          'Each post shows "Seen by N" — the parents and students who have opened the Class Diary since it was posted.',
        ],
        gotcha:
          "It counts accounts, not families: a parent and a student reading the same post count twice. A family without a portal login never counts.",
      },
      {
        name: "Edit, pin or delete a post",
        steps: [
          "Use the pencil or bin icon on the post.",
          'In the editor, tick "Pin to the top of the diary" to keep it above the daily posts.',
        ],
      },
    ],
    related: ["/teacher/class-diary", "/fees/dues"],
  },
  {
    path: "/calendar",
    title: "Calendar",
    purpose:
      "School calendar events — exams, holidays, PTA meetings — optionally scoped to a class and optionally published to the public website.",
    tasks: [
      {
        name: "Add an event",
        steps: [
          'Click "Add Event".',
          'Fill "Title" and "Description (optional)".',
          'Pick "Event Type" and "Class (optional)" — it defaults to All Classes.',
          'Set "Start Date" and "End Date (optional)".',
          'Click "Add Event".',
        ],
        gotcha:
          '"Show on public website" is ticked by default. Untick it for anything internal.',
      },
      {
        name: "Filter by event type",
        steps: ["Click one of the pills: All, Exam, Holiday, Event, PTA Meeting, Other."],
        gotcha:
          "These filter the query itself, so the row count and any export change with them.",
      },
    ],
    related: ["/academics/classes"],
  },
  {
    path: "/attendance",
    title: "Attendance",
    purpose:
      "Read-only class-wise attendance summary for a date range. Marking happens in the teacher portal.",
    tasks: [
      {
        name: "Run a class-wise report",
        steps: [
          'Pick "Class" (defaults to All Classes).',
          'Set "From" and "To".',
          "The table refreshes on its own — there is no Run button.",
        ],
        gotcha:
          "A late record counts as present in the Present column AND again in the Late column. The four cards at the top always show today, ignoring your date range and class filter.",
      },
      {
        name: "Mark attendance",
        steps: [
          "You cannot do it here — this screen is read-only.",
          "Day-to-day marking is in the teacher portal at /teacher/attendance.",
        ],
      },
    ],
    related: ["/reports/students", "/teacher/attendance"],
  },

  // ── Exams: the setup order matters ───────────────────────────────────────
  // Grade Master → Exam Types → Result Master (Basic Rules → Subjects →
  // ADVANCED) → marks entry → Publish. Skipping the Advanced tab is the single
  // most damaging mistake in this module and every entry below says so.
  {
    path: "/exams",
    title: "Exams",
    purpose:
      "Hub page for the examination module — a tile each for Exam Types, Grade Master, Result Master, Header / Footer, Non-Scholastic Masters, Exam Timetable, Admit Cards, Results and Class Tests.",
    tasks: [
      {
        name: "Set a new session up in the right order",
        steps: [
          "Grade Master first — the bands every result is graded against.",
          "Then Exam Types, then Result Master (Basic Rules → Subjects → ADVANCED).",
          "Only then enter marks, and publish last.",
        ],
        gotcha:
          "The tiles are laid out for browsing, not as a running order. Result Master's ADVANCED tab is the step people skip, and skipping it is the single most damaging mistake in this module.",
      },
    ],
    related: ["/exams/grade-master", "/exams/result-master", "/exams/results"],
  },
  {
    path: "/exams/grade-master",
    title: "Grade Master",
    purpose:
      "Letter-grade percentage bands, globally or per class, for scholastic and non-scholastic grades.",
    tasks: [
      {
        name: "Create a grade scale",
        steps: [
          'Choose the "Scholastic" or "Non-Scholastic" tab.',
          'Click "New Scale".',
          'Type a "Name" and tick the default box if it should be the fallback.',
          'Under "Grade bands" click "Add band" and fill Label, Min %, Max % per row.',
          'Under "Apply to classes" tick the classes, then "Create".',
        ],
        adminOnly: true,
        needs: "Classes must exist for the academic year.",
        gotcha:
          "With no scale resolving at all, every grade comes out blank on report cards — the marks still compute, but no letter grade prints.",
      },
      {
        name: "Delete a scale",
        steps: [
          "Click the red trash icon.",
          "If it is the default, pick a replacement to promote, then confirm.",
        ],
        adminOnly: true,
        gotcha:
          "Delete stays disabled for a non-default scale that is still assigned to classes — remove the assignments in Edit first.",
      },
    ],
    related: ["/exams/result-master", "/exams/non-scholastic-masters"],
  },
  {
    path: "/exams/types",
    title: "Exam Types",
    purpose:
      "Each exam instance for a year — name, kind, max marks, weight, and which class level it applies to.",
    tasks: [
      {
        name: "Create an exam type",
        steps: [
          "Pick the year in the session dropdown.",
          'Click "Add Exam Type".',
          'Fill "Name", "Applies to level", "Kind", "Sort Order", "Max Marks" and "Weightage %".',
          'Click "Create".',
        ],
        needs: "An academic year must exist.",
        gotcha:
          "The Weightage % you type here does NOT drive report cards. It only seeds the grid on Result Master → Advanced, and nothing is saved until you press Save there.",
      },
      {
        name: "Balance a level to 100%",
        steps: [
          "Click a level card — All, Pre-Primary, Primary, Middle, Secondary or Sr. Sec.",
          'Read the chip: "Balanced · 100%" or "N% unallocated".',
          'Click "Auto-balance" and confirm.',
        ],
        gotcha:
          'Auto-balance is disabled on the "All Levels" tab. It writes exam-type weights, not the per-class configs — you still have to save Result Master → Advanced for each class.',
      },
    ],
    related: ["/exams/result-master", "/exams/timetable"],
  },
  {
    path: "/exams/result-master",
    title: "Result Master",
    purpose:
      "Per class and year, the rules that produce the final result and report card — pass criteria, subject roles, exam weightage, grace, rounding.",
    tasks: [
      {
        name: "Create the master for a class",
        steps: [
          "Pick a class and academic year.",
          'Click "Create Result Master".',
        ],
        adminOnly: true,
        gotcha:
          "With no master at all, the report card falls back to the legacy layout and no final result computes for anyone in that class.",
      },
      {
        name: "Set pass rules",
        steps: [
          'Open the "Basic Rules" tab.',
          'Choose "Pass mark mode" — Percentage or Raw marks — and enter the value.',
          'Pick "Pass criteria" and fill its panel.',
          'Click "Save Basic Rules".',
        ],
        adminOnly: true,
      },
      {
        name: "Choose which subjects count",
        steps: [
          'Open the "Subjects" tab.',
          'Tick "Incl." for each subject on the final result.',
          'Set "Role" to Main or Optional.',
          'Click "Save Subjects".',
        ],
        adminOnly: true,
        needs: "Subjects must be assigned to the class under Academics → Subjects.",
        gotcha:
          "At least one Main subject is required — only Main subjects feed the aggregate. A master saved with zero subjects behaves exactly like no master at all.",
      },
      {
        name: "Set exam weightage — the step that makes results non-zero",
        steps: [
          'Open the "Advanced" tab and find the Weightage card.',
          'Tick "Incl." per exam and type its "Weight (%)".',
          'Check the chip reads "Sum: 100%".',
          'Click "Save Advanced Settings".',
        ],
        adminOnly: true,
        needs: "Exam types must exist for the year.",
        gotcha:
          "THIS IS THE SILENT-ZERO TRAP. The grid pre-fills from the exam types, so it looks already configured — but nothing is written until you press Save Advanced Settings. Leave this tab untouched and every subject scores 0 on real report cards, with no warning anywhere.",
      },
      {
        name: "Check a real student before publishing",
        steps: [
          'Open the "Preview" tab and pick a student.',
          'Click "Refresh" after changing anything on another tab.',
          'Read the "Config applied" card, and use "Download sample PDF".',
        ],
        adminOnly: true,
        gotcha:
          "All-zero subjects here almost always means unsaved weightage on the Advanced tab. Preview uses live data, so it shows marks parents cannot see yet.",
      },
    ],
    related: ["/exams/types", "/exams/grade-master", "/exams/publish", "/exams/green-sheet"],
  },
  {
    path: "/exams/non-scholastic-masters",
    title: "Non-Scholastic Masters",
    purpose:
      "Co-scholastic areas (Discipline, Arts, Sports) and the sub-skills graded under each.",
    tasks: [
      {
        name: "Create a co-scholastic subject",
        steps: [
          'On the "Subjects" tab click "New Subject".',
          'Enter a "Name" and "Sort Order", leave "Active" ticked.',
          "Save.",
        ],
        adminOnly: true,
      },
      {
        name: "Add sub-skills",
        steps: [
          'Click "Sub" on the subject card, or use the "Sub-Subjects" tab.',
          "Pick the parent subject and type a name.",
          'Optionally pick a "Grade scale (optional)".',
          "Save.",
        ],
        adminOnly: true,
        needs: "At least one non-scholastic subject must exist.",
        gotcha:
          "A class restriction hides the sub-skill from every other class's grid entirely.",
      },
    ],
    related: ["/exams/non-scholastic-assessments", "/exams/grade-master"],
  },
  {
    path: "/exams/non-scholastic-assessments",
    title: "Non-Scholastic Grades",
    purpose:
      "Enter and override co-scholastic grades for any class and exam. Lives under Examinations → Marks Entry; it used to be listed under Academics, which is where people still look for it.",
    tasks: [
      {
        name: "Grade a class",
        steps: [
          "Pick Class, Exam Type and Co-scholastic Subject — the grid only appears when all three are set.",
          'Choose a grade in each cell ("—" clears it).',
          'Click "Save All".',
        ],
        needs:
          "Sub-subjects configured under Non-Scholastic Masters, a grade scale with bands, and active enrolments.",
        gotcha:
          "These grades only reach the report card when Result Master → Advanced has \"include non-scholastic\" ticked.",
      },
    ],
    related: ["/exams/non-scholastic-masters", "/exams/publish"],
  },
  {
    path: "/exams/timetable",
    title: "Exam Timetable",
    purpose:
      "Date, time, room and notes for each paper, per class and exam. Admit cards read this directly.",
    tasks: [
      {
        name: "Schedule a paper",
        steps: [
          "Pick Exam and Class.",
          'Click "Add subject".',
          "Set Subject, Date, Start time, End time, and optionally Room and Notes.",
          'Click "Add".',
        ],
        needs: "An exam type for the session, and a class with subjects assigned.",
        gotcha:
          '"Add subject" is disabled once every class subject is scheduled. To move a paper to a different subject you must delete the entry and create a new one — the Subject field is locked while editing.',
      },
    ],
    related: ["/exams/admit-cards", "/exams/types"],
  },
  {
    path: "/exams/admit-cards",
    title: "Admit Cards",
    purpose: "Admit-card templates, and per-student or per-class PDF generation.",
    tasks: [
      {
        name: "Build a template",
        steps: [
          'On the "Templates" tab click "New Template".',
          "Set Name and Orientation.",
          'Tick entries under "Fields to show".',
          'Add signature rows with "Add signature slot", then "Create".',
        ],
        gotcha:
          "Only ACTIVE templates appear in the Generate tab. A template that is default but inactive is invisible there.",
      },
      {
        name: "Generate admit cards",
        steps: [
          'Open the "Generate" tab.',
          "Set Exam, Class and Template.",
          'Click "Display students".',
          'Tick rows and click "Download Selected (N)", or "Download Class (N)".',
        ],
        gotcha:
          "With no exam timetable rows you get an amber warning and the PDF still generates — with an empty schedule table on it.",
      },
    ],
    related: ["/exams/timetable", "/exams/header-footer"],
  },
  {
    path: "/exams/class-tests",
    title: "Class Tests",
    purpose:
      "Unit tests and formative assessments, kept separately from formal exams and optionally folded into the final result.",
    tasks: [
      {
        name: "Create a class test",
        steps: [
          "Pick a Class.",
          'Click "New Test".',
          'Set Class, Subject, Name, Date, "Max marks" and optionally "Weightage (%, optional)".',
          'Click "Create".',
        ],
        gotcha:
          "Leave the weightage blank and the test contributes NOTHING to the final result. Class and Subject cannot be changed after creation.",
      },
      {
        name: "Enter marks",
        steps: [
          'Click "Marks" on the test row.',
          "Type each student's marks — the Grade column previews live.",
          'Click "Save Marks".',
        ],
        gotcha:
          "Save is blocked while any value exceeds the max. Blank cells clear a mark rather than scoring zero.",
      },
      {
        name: "Publish a class test",
        steps: ["Click the eye icon on the row."],
        gotcha:
          "Only published class tests are pulled into the final-result engine. This toggle lives on the row here — the Publish & Finalize screen does not cover class tests.",
      },
    ],
    related: ["/exams/result-master", "/teacher/class-tests"],
  },
  {
    path: "/exams/header-footer",
    title: "Header / Footer",
    purpose: "School branding and signature blocks for each kind of PDF.",
    tasks: [
      {
        name: "Configure branding for a PDF type",
        steps: [
          "Pick a Template — Report Card, Admit Card, White Sheet or Green Sheet.",
          "Fill the Header card: School Name, Address Line, Affiliation, Logo URL, Motto.",
          "Fill the Footer card and add signature rows.",
          'Click "Save Template".',
        ],
        adminOnly: true,
        gotcha:
          "Header and footer are stored PER TEMPLATE. Configuring Report Card does nothing for Admit Card. Unticking Active silently drops the block from the next render.",
      },
    ],
    related: ["/exams/admit-cards", "/exams/white-sheet"],
  },
  {
    path: "/exams/results",
    title: "Results",
    purpose:
      "Read-only class and subject performance summary for one exam, plus the way into editing marks and historical import.",
    tasks: [
      {
        name: "Review a class's performance",
        steps: ["Pick Class and Exam Type.", "Read the summary cards and subject breakdown."],
        gotcha:
          "The pass rate shown here is a fixed 40% cut-off, NOT your Result Master pass criteria. Treat it as indicative only.",
      },
      {
        name: "Edit one student's marks",
        steps: [
          'Click "Edit student results".',
          "Filter by class and exam, or search for the student, then click them.",
          'Expand an exam card, edit "Obtained" and click "Save".',
        ],
        gotcha:
          'Published rows are locked — only "Unlock" shows. Unlocking makes the published marksheet inconsistent until you re-publish from Publish & Finalize.',
      },
      {
        name: "Import results from the old ERP",
        steps: [
          'Click "Bulk import historical results".',
          "Pick the academic year and choose the XLSX file.",
          'Click "Preview" and read the counts.',
          "Map any unrecognised class names, then re-preview and import.",
        ],
        gotcha:
          "It auto-creates missing classes, subjects and exam types. Those synthetic exam types arrive with no weightage, so imported years compute a zero final result until you configure Result Master → Advanced for them.",
      },
    ],
    related: ["/exams/publish", "/exams/result-master", "/teacher/results"],
  },
  {
    path: "/exams/publish",
    title: "Publish & Finalize",
    purpose:
      "Two stages: make marks visible to parents and students, then freeze immutable marksheet PDFs.",
    tasks: [
      {
        name: "Stage 1 — make marks visible online",
        steps: [
          "Pick Class and Exam Type.",
          'Check the "Published N / M" counter.',
          'Click "Publish all".',
        ],
        gotcha:
          "This is what gates parent and student visibility. Unpublished marks still show in Result Master → Preview, so \"it works for me but parents see nothing\" is normal and this is the fix. Publishing also locks the rows against editing.",
      },
      {
        name: "Stage 2 — freeze the marksheets",
        steps: [
          'Review the Students / Finalized / Pending tiles under "Stage 2 · Finalize Marksheet".',
          'Click "Finalize all", or tick rows and click "Finalize selected (N)".',
          "When re-finalizing, type a reason when prompted.",
        ],
        gotcha:
          "A snapshot is frozen — later mark edits do NOT change a finalized marksheet. Fixing marks and re-finalizing is the only correction path, and each one bumps the version.",
      },
      {
        name: "Year-final marksheet",
        steps: [
          'With a class selected, scroll to "Year-Final Marksheet".',
          'Click "Finalize all".',
        ],
        gotcha:
          "This runs off the class's academic year, not the exam-type selector. Snapshotting a class whose Advanced weightages were never saved freezes zeros into the official year-final PDFs.",
      },
    ],
    related: ["/exams/results", "/exams/result-master"],
  },
  {
    path: "/exams/ptm-notes",
    title: "PTM Notes",
    purpose:
      "Attendance, teacher and parent remarks and action points per student, per meeting date.",
    tasks: [
      {
        name: "Record a meeting",
        steps: [
          'Set "Class", optionally "Exam", and a "Meeting date".',
          "Fill attendance and the remark columns per student.",
          'Click "Save meeting".',
        ],
        needs: "Both a class AND a meeting date — the grid stays hidden until both are set.",
        gotcha:
          "One entry per student per meeting date. Re-picking the same date reloads and overwrites that meeting.",
      },
    ],
    related: ["/exams/ptm-format", "/teacher/ptm-notes"],
  },
  {
    path: "/exams/ptm-format",
    title: "PTM Format",
    purpose:
      "Design the printable pre-meeting handout and generate one page per student.",
    tasks: [
      {
        name: "Generate handouts for a class",
        steps: [
          'In "Generate PDF" pick a Class.',
          "Pick an exam for the performance snapshot, or skip it.",
          "Pick a template or use the default.",
          'Click "Download PDF".',
        ],
      },
      {
        name: "Edit a handout template",
        steps: [
          'Click a template in "Templates", or "New".',
          "Set the name, intro and closing text, and tick the sections to show.",
          'Click "Save template".',
        ],
        adminOnly: true,
        gotcha:
          "The entire template editor is admin-only. Editors see only the Generate PDF card.",
      },
    ],
    related: ["/exams/ptm-notes"],
  },
  {
    path: "/exams/supplementary",
    title: "Supplementary Exams",
    purpose:
      "Students who narrowly failed subjects, their retest marks, and the recomputed result.",
    tasks: [
      {
        name: "Record retest marks",
        steps: [
          "Set Class, Parent exam and Retest date.",
          "Review the eligibility table.",
          'Type "Retest marks" — the Outcome computes on blur and can be overridden.',
          'Click "Save retest marks".',
        ],
        needs: "A configured Result Master, and marks already recorded for the parent exam.",
        gotcha:
          "The amber banner tells you to set a supplementary threshold on Result Master — but there is no control for it anywhere in the app today, so every failing student shows as eligible. Re-finalize on Publish & Finalize after saving.",
      },
    ],
    related: ["/exams/result-master", "/exams/publish"],
  },
  {
    path: "/exams/blank-marks-list",
    title: "Blank Marks List",
    purpose: "Print a roster with an empty marks column for invigilators.",
    tasks: [
      {
        name: "Print a blank sheet",
        steps: [
          "Pick Class, then Exam, then Subject.",
          'Click "Download PDF".',
        ],
        gotcha: "The Subject dropdown stays disabled until you have picked a class.",
      },
    ],
    related: ["/exams/white-sheet"],
  },
  {
    path: "/exams/white-sheet",
    title: "White Sheet",
    purpose:
      "One exam's marks for a whole class — subjects across, students down, with totals and grade.",
    tasks: [
      {
        name: "Export the class marks grid",
        steps: [
          "Pick Class and Exam.",
          "Check the on-screen preview.",
          'Click "CSV" or "PDF".',
        ],
        gotcha:
          "Without a Result Master the preview warns that EVERY subject is treated as main, so the totals you print will not match the report card.",
      },
    ],
    related: ["/exams/green-sheet", "/exams/result-master"],
  },
  {
    path: "/exams/green-sheet",
    title: "Green Sheet",
    purpose:
      "The year-end consolidated sheet — every exam's marks plus the weighted final result.",
    tasks: [
      {
        name: "Export the consolidated sheet",
        steps: [
          "Pick Academic Year, then Class.",
          'Check the preview — each exam header shows its weight, e.g. "Annual (40%)".',
          'Click "CSV" or "PDF".',
        ],
        needs: "A configured Result Master with saved Advanced weightages.",
        gotcha:
          "If the exam headers show no percentage, the Advanced tab was never saved and the Final columns will be zeros. That is the fastest way to spot the problem.",
      },
    ],
    related: ["/exams/result-master", "/exams/publish"],
  },

  // ── Fees ─────────────────────────────────────────────────────────────────
  // The chain: a fee schedule for the class → the Fee dropdown on Record
  // Payment has something in it → the dues register is meaningful. Skip the
  // first and everything downstream reads as zero.
  {
    path: "/fees/academic",
    title: "Academic Fees",
    purpose:
      "The instalment-wise fee schedule per class — what every payment, due and no-dues figure is computed from.",
    tasks: [
      {
        name: "Build a class's fee schedule",
        steps: [
          'On the "Fee Schedule" tab pick the class.',
          "For XI and XII also pick a stream — the grid stays hidden until you do.",
          'Click "Add Row" and fill Fee Head, Due Date, Instalment Name, Amount, Student Type and Month Name.',
          'Optionally click the "Late Fee" cell to set a rule, then "Done".',
          'Click "Save".',
        ],
        needs: "An academic year marked current.",
        gotcha:
          'Nothing is written until Save — "Clear all rows" only stages a deletion. One bad row blocks the whole save with a "Row N: ..." message.',
      },
      {
        name: "Copy a schedule to other classes",
        steps: [
          "Save the source class first.",
          'Click "Copy to classes".',
          "Tick the target classes and confirm.",
        ],
        gotcha:
          "Copy is disabled while there are unsaved changes. Each target's existing schedule is REPLACED, though rows that already have receipts are deactivated rather than deleted.",
      },
      {
        name: "Add a one-off fee structure",
        steps: [
          'Switch to the "All Structures" tab.',
          'Click "Add Fee Structure".',
          "Fill Class, Fee Type, Amount, Frequency and the optional date fields.",
          "Submit.",
        ],
        gotcha:
          "Setting a Stream on a fee type makes it HIDE the all-streams row of the same type for students in that stream.",
      },
    ],
    related: ["/fees/payments", "/fees/dues", "/transport/stops"],
  },
  {
    path: "/fees/payments",
    title: "Payment Management",
    purpose:
      "Record payments and refunds, read one student's balance and history, and print receipts.",
    tasks: [
      {
        name: "Record a fee payment",
        steps: [
          "Pick a class and find the student with the search box.",
          'Click the row, or its "View Fees" button.',
          'Click "Record Payment".',
          'Choose the instalment in the "Fee" dropdown, enter the "Amount" and pick a "Payment Method".',
          "Fill the cheque, bank-transfer or online block that appears.",
          'Click "Record Payment" — the toast carries the receipt number.',
        ],
        needs:
          "A fee structure must already exist for that class and stream, or the Fee dropdown is empty and the save fails. A transport line only appears if the student has a stop assigned AND that stop has a fee.",
        gotcha:
          "The Outstanding Dues panel shows dues as of today — instalments falling due later this session are deliberately excluded.",
      },
      {
        name: "Download a receipt",
        steps: [
          'Scroll to "Payment History".',
          "Click the green download icon on the row.",
        ],
      },
      {
        name: "Refund a payment",
        steps: [
          'Click "Refund" on the row in Payment History.',
          "Enter the amount and a reason of at least five characters.",
          'Click "Confirm Refund".',
        ],
        gotcha:
          "Editors cannot refund directly — the dialog becomes \"Request Refund\" and files a change request an admin approves at Fees → Change Requests. One refund per payment; it can be partial but not split.",
      },
      {
        name: "Record a waiver or concession",
        steps: [
          'Click "Record Waiver".',
          "Pick the fee structure, enter the amount and a reason.",
          'Click "Record Waiver".',
        ],
        gotcha:
          "A waiver counts toward no-dues without a cash receipt, and can never be refunded.",
      },
    ],
    related: ["/fees/academic", "/fees/dues", "/fees/change-requests"],
  },
  {
    path: "/fees/dues",
    title: "Dues & No-Dues",
    purpose: "The class-wide arrears register — who owes what, and who is clear.",
    tasks: [
      {
        name: "Read a class's dues",
        steps: [
          "Choose the class.",
          'Optionally tick "Include students who left".',
          'Switch between the "Dues (N)" and "No Dues (N)" tabs.',
        ],
        gotcha:
          "Dues are counted as of TODAY. \"Due Till Date\" and \"Annual Fee\" are deliberately different numbers — later instalments show in the annual figure but are not arrears. A student who left is counted as of their leaving date instead: the grey badge next to their name carries that date, and a \"Left On\" column appears in the export.",
      },
      {
        name: "Go from a defaulter to taking their money",
        steps: ["Click the student's name — it links straight to their payment screen."],
      },
    ],
    related: ["/fees/payments", "/fees/academic"],
  },
  {
    path: "/fees/change-requests",
    title: "Fee Change Requests",
    purpose:
      "The approval queue for editor-filed proposals to modify recorded fee payments.",
    tasks: [
      {
        name: "Approve or reject a request",
        steps: [
          'Stay on the "Pending" tab.',
          "Click a request to open it.",
          'Check the "Payment for" / "Waiver for" header — it names the student, the fee head and the session the request is about.',
          'Read the "Proposed change" diff.',
          'Click "Approve & apply" or "Reject".',
        ],
        adminOnly: true,
        gotcha:
          'An amber "Row drifted since this request was filed" banner means the payment changed after the request — approving overwrites the live values. Approving a delete request deletes the payment row. A field shown as "Unknown record" means the student or fee head it pointed at has since been deleted; do not approve it blind.',
      },
      {
        name: "Cancel your own request",
        steps: ['Open the request and click "Cancel request".'],
      },
    ],
    related: ["/fees/payments"],
  },

  // ── Transport ────────────────────────────────────────────────────────────
  // The chain: stop (with a fee for THIS year) → a bus whose route covers it →
  // the student assignment → a transport line on Record Payment.
  {
    path: "/transport/stops",
    title: "Stops & Fees",
    purpose:
      "The bus-stop master and the monthly transport fee each stop carries for the active year.",
    tasks: [
      {
        name: "Add a bus stop",
        steps: ['Click "Add Stop".', 'Enter "Stop Name" and set Status.', 'Click "Create Stop".'],
      },
      {
        name: "Set a stop's monthly fee",
        steps: [
          "Click the green rupee icon on the row.",
          'Enter "Monthly Fee (₹)".',
          'Click "Save Fee".',
        ],
        needs: "An academic year marked active.",
        gotcha:
          "The fee is stored PER ACADEMIC YEAR. A new session needs every stop's fee set again, or transport billing silently reads as zero.",
      },
      {
        name: "Delete a stop",
        steps: ["Click the red trash icon and confirm."],
        gotcha: "This removes the stop's fee for ALL years, not just the current one.",
      },
    ],
    related: ["/transport/buses", "/transport/assignments"],
  },
  {
    path: "/transport/buses",
    title: "Buses & Routes",
    purpose:
      "The vehicle register — bus number, driver, capacity — and which stops each bus serves.",
    tasks: [
      {
        name: "Register a bus",
        steps: [
          'Click "Add Bus".',
          'Fill "Bus Number *", "Registration No.", "Capacity" and "Driver".',
          'Click "Create Bus".',
        ],
        needs:
          'The Driver dropdown only lists staff whose category is "Bus Drivers" — add them under People → Staff first.',
      },
      {
        name: "Define which stops a bus serves",
        steps: [
          "Click the amber route icon on the bus row.",
          "Tick each stop this bus serves.",
          'Click "Save Route".',
        ],
        needs: "Stops must exist.",
        gotcha:
          'A student whose stop is on no bus route shows "No route covers this stop" on the assignments page. The fix is here, not there.',
      },
    ],
    related: ["/transport/stops", "/transport/drivers", "/transport/assignments"],
  },
  {
    path: "/transport/drivers",
    title: "Drivers",
    purpose: "Read-only roster of bus drivers with their bus and rider count.",
    tasks: [
      {
        name: "Add or edit a driver",
        steps: [
          "You cannot do it here — this page has no create or edit controls at all.",
          'Drivers are created under People → Staff with category "Bus Drivers".',
          "They are attached to a vehicle on Transport → Buses & Routes.",
        ],
      },
    ],
    related: ["/people/staff", "/transport/buses"],
  },
  {
    path: "/transport/assignments",
    title: "Student Assignments",
    purpose:
      "Put an individual student on transport — their stop, bus, direction and any one-side fee.",
    tasks: [
      {
        name: "Put a student on transport",
        steps: [
          "Narrow by class, or search by name or admission number.",
          "Click the blue pencil on the student's row.",
          'Tick "Uses school transport".',
          'Pick a "Bus Stop", optionally a "Bus (optional)", and a "Direction".',
          'If the direction is not both sides, enter a "Custom one-side fee (₹)".',
          'Click "Save".',
        ],
        needs: "The stop must exist and carry a fee for this year.",
        gotcha:
          "A one-way rider without a custom fee is refused — the flat stop fee covers both legs, so saving without it would bill them wrong. Changing the stop clears a bus that no longer serves it.",
      },
      {
        name: "Quick-assign the suggested bus",
        steps: [
          'Click "Needs a bus (N)" to filter.',
          "Click the sparkle button in the Bus column showing the suggested bus and seats free.",
        ],
      },
      {
        name: "Remove a student from transport",
        steps: [
          "Click the red trash icon on the row.",
          'Read the summary and click "Remove from transport".',
        ],
        gotcha:
          "The transport charge is derived from these columns, not stored as ledger rows — so clearing them removes the unpaid transport dues for the WHOLE year, including months already ridden. Receipted payments are kept.",
      },
    ],
    related: ["/transport/stops", "/transport/buses", "/transport/changes", "/fees/payments"],
  },
  {
    path: "/transport/changes",
    title: "Transport Change Requests",
    purpose:
      "Parent-submitted transport changes to review, and office-initiated changes with effective dates.",
    tasks: [
      {
        name: "Approve or reject a parent request",
        steps: [
          "Set the status dropdown to Pending.",
          'Click "View" in the Application column if one was uploaded.',
          'Click "Approve" or "Reject".',
        ],
        gotcha:
          "Unlike fee change requests, these can be actioned by an editor as well as an admin. Approving applies the change to the enrolment immediately.",
      },
      {
        name: "Record an office-initiated change",
        steps: [
          'Click "Record change".',
          "Pick the student and a Change Type, then fill the field it reveals.",
          'Set "Effective From" and optionally "Effective To".',
          'Pick a Reason and add a note, then click "Record change".',
        ],
        gotcha:
          "This applies immediately — it does not sit in the pending queue. A direction change needs a one-side fee already set on the Assignments page.",
      },
    ],
    related: ["/transport/assignments"],
  },

  // ── Timetable ────────────────────────────────────────────────────────────
  {
    path: "/timetable/templates",
    title: "Period Templates",
    purpose:
      "The bell schedule — period positions, times, lunch and breaks — that auto-generate uses.",
    tasks: [
      {
        name: "Create a template you can edit",
        steps: [
          'Click "Clone Template".',
          'Pick a source under "Clone from" and type a new name.',
          'Click "Clone".',
        ],
        gotcha:
          'Built-in templates cannot be edited or deleted — the tooltip says "Clone first to edit". Clone one and edit the copy.',
      },
      {
        name: "Edit period times",
        steps: [
          'Click "Edit" on a template card.',
          "Adjust each row's Kind, Label, Start and End.",
          'Use "+ Period", "+ Lunch" or "+ Break" to add rows.',
          'Click "Save".',
        ],
        gotcha: "Every template must include a lunch slot, or the save is rejected.",
      },
    ],
    related: ["/timetable/generate", "/timetable"],
  },
  {
    path: "/timetable/teachers",
    title: "Teacher Timetable",
    purpose: "One teacher's week across all classes, and the way into marking them absent.",
    tasks: [
      {
        name: "View a teacher's week",
        steps: ['Choose from "Select a teacher...".', "Read the grid."],
        gotcha:
          "One slot can show several cards. A coach running a shared activity really is with more than one class at that time; the group name follows the subject.",
      },
      {
        name: "Print a teacher's timetable",
        steps: ['Choose from "Select a teacher...".', 'Click "Print".'],
        gotcha:
          "A coach running a shared activity appears once per class in the same slot, so their sheet shows all of those sections stacked in that cell.",
      },
      {
        name: "Mark a teacher absent",
        steps: [
          'Click "Mark absent" on the day header.',
          "Set the Date, Coverage and an optional Reason.",
          'Click "Mark absent".',
        ],
        gotcha:
          "This only RECORDS the absence. Assigning who covers each period happens on Timetable → Substitutions.",
      },
    ],
    related: ["/timetable/substitutions", "/timetable"],
  },
  {
    path: "/timetable/substitutions",
    title: "Substitutions",
    purpose:
      "For one date: who is absent, and which free teacher covers each affected period.",
    tasks: [
      {
        name: "Assign a substitute",
        steps: [
          "Set the Date.",
          'Pick an absent teacher from the "Absent on ..." list.',
          'Click "Find substitute" on a period.',
          'Click "Assign" next to a candidate.',
        ],
        needs: "An absence must already be recorded for that date.",
        gotcha:
          "Candidates are only teachers free in that slot, ranked with reasons. If there are none you are told to combine classes or reschedule.",
      },
      {
        name: "Print the day's substitution sheet",
        steps: ["Set the Date.", 'Click "Print sheet".'],
        gotcha: "Disabled when nobody is absent that day.",
      },
    ],
    related: ["/timetable/teachers", "/timetable"],
  },
  {
    path: "/timetable/clashes",
    title: "Clash Check",
    purpose:
      "Every teacher who is in two places at once, and whether anyone meant it.",
    tasks: [
      {
        name: "Check nothing has slipped through",
        steps: [
          'Open the page — it lands on "Needs attention".',
          "Read the list. An empty one is the answer you want.",
          "For anything listed, open the Class Timetable and fix one of the two cells.",
        ],
        gotcha:
          "A teacher normally cannot be double-booked at all — the database refuses it. So anything under Needs attention got in before that rule existed, or through an import that bypassed it. It will not disappear on its own.",
      },
      {
        name: "Review the deliberate ones",
        steps: [
          'Click "Shared activities".',
          "Each line is one teacher, one time, and every class they take together.",
        ],
        gotcha:
          "One line per booking, not per pair of classes — a coach taking four sections is a single row reading \"VI-A, VI-B, VII-A, VII-B\", not six.",
      },
    ],
    related: ["/timetable", "/timetable/teachers"],
  },
  {
    path: "/timetable/generate",
    title: "Auto Generate",
    purpose:
      "Fill class timetables automatically from a period template, avoiding teacher clashes.",
    tasks: [
      {
        name: "Generate timetables",
        steps: [
          'Pick a "Template".',
          "Toggle the day chips.",
          'Decide "Replace existing periods on selected days".',
          "Tick the classes.",
          'Click "Generate" and read the Result panel.',
        ],
        needs:
          "A period template must exist, and each class must have subjects assigned — otherwise every slot is skipped with \"No subjects assigned to this class\".",
        gotcha:
          "Without Replace ticked, existing periods are left alone and those slots count as skipped. Read the \"Skipped slots\" list — it names the reason for each.",
      },
    ],
    related: ["/timetable/templates", "/timetable", "/academics/subjects"],
  },
  {
    path: "/timetable/import",
    title: "Import from Excel",
    purpose: "Bulk-load periods from a spreadsheet, with a full preview first.",
    tasks: [
      {
        name: "Import a timetable spreadsheet",
        steps: [
          'Click "Download template".',
          'Choose your file and click "Parse & Preview".',
          "Fix any errors and re-parse.",
          'Decide whether to tick "Overwrite existing periods".',
          'Click "Commit N row(s)".',
        ],
        needs: "Classes, subjects and teachers must exist so the cells resolve.",
        gotcha: "Commit is blocked while ANY row has an error. Warnings do commit.",
      },
      {
        name: "Import a period that runs two or more groups",
        steps: [
          'Click "Download template" — it ends with a "Group" and a "Shared" column.',
          "Write one row per group, all carrying the same Section, Day and Period.",
          'Give each a different Group: a name such as Basketball, or a number. Blank means the main group.',
          'Put "yes" in Shared on any row whose teacher is taking several classes in that slot.',
          'Click "Parse & Preview", then "Commit".',
        ],
        gotcha:
          "Both columns are optional, so a sheet written before they existed imports exactly as it always did. Two rows sharing a Section, Day, Period AND Group is still an error, and a teacher in two places at once is still an error unless those rows say Shared.",
      },
    ],
    related: ["/timetable", "/timetable/generate"],
  },
  {
    path: "/timetable",
    title: "Class Timetable",
    purpose:
      "One class's weekly Mon-Sat period grid, which repeats for the whole academic year.",
    tasks: [
      {
        name: "Add or edit a period",
        steps: [
          'Pick the class in "Select a class...".',
          'Click any cell in the grid (an empty one shows a "+").',
          "Set Day, Period, Subject, Teacher, Start Time, End Time and Room.",
          'Click "Add" or "Update".',
        ],
        needs: "Classes for the selected year, and active subjects and teachers.",
        gotcha:
          "A teacher already booked elsewhere at that time is refused on save. The database enforces it, so it holds no matter how the period was created. On a phone the grid is one day at a time — pick the day from the Mon-Sat strip above it; it opens on today.",
      },
      {
        name: "Run two or more things in one period",
        steps: [
          "Open the cell you want to split.",
          'Click "Add group".',
          'Type a "Group name" — Basketball, Cricket, P.Ed — and set that group\'s own Subject and Teacher.',
          'Click "Add", then use the chips along the top of the dialog to move between the cell\'s groups.',
        ],
        gotcha:
          "The grid shows one line per group. Deleting a group leaves the others alone; delete the first one and the next in line becomes the period's main group.",
      },
      {
        name: "Print the class timetable",
        steps: [
          'Pick the class in "Select a class...".',
          'Click "Print".',
        ],
        needs: "A class with periods on it — an empty timetable prints a sheet that says so.",
        gotcha:
          "The PDF opens in a new tab. It shows every parallel group, one line per group, so a Games period names all three coaches — which is the whole reason it is worth printing rather than screenshotting.",
      },
      {
        name: "Let one teacher take several classes at once",
        steps: [
          "Open the group that teacher runs.",
          'Tick "Shared activity (several classes together)".',
          'Click "Add" or "Update".',
          "Repeat for the same period in each of the other classes.",
        ],
        gotcha:
          "Shared is the only way past the double-booking check — a games coach on the field for VI-A, VI-B and VII-A is three shared rows. Every other clash is still refused. Groups added after the first arrive with Shared pre-ticked; untick it if that group is really one class on its own.",
      },
    ],
    related: ["/timetable/generate", "/timetable/import", "/timetable/teachers"],
  },

  // ── Reports ──────────────────────────────────────────────────────────────
  {
    path: "/reports",
    title: "Reports",
    purpose:
      "Hub page for the report builder: 'Build a sheet: choose the rows, choose the columns, export it.'",
    tasks: [
      {
        name: "Start from a suggested report",
        steps: [
          "Four cards: Student Custom Report, Fee Report, Attendance Report, Result Report.",
          "Each exports to CSV, Excel and PDF.",
        ],
        gotcha:
          "Fee, Attendance and Result are not separate reports — they open the same builder with a suggested set of columns preselected. Change anything, or combine all three in one sheet.",
      },
    ],
    related: ["/reports/students", "/reports/ask"],
  },
  {
    path: "/reports/ask",
    title: "Ask your school",
    purpose:
      "Ask for a student list in plain language. Same records, permissions and export log as the report builder.",
    tasks: [
      {
        name: "Ask a question",
        steps: [
          "Type what you want, e.g. \"Class IX students with fees pending who don't take the bus\".",
          "Read the answer, then use the table below it.",
          'Click "Download CSV" for the full list.',
        ],
        gotcha:
          'Personal columns are withheld unless you tick "Include PII" first. If a turn ran more than one report, chips above the table let you switch between them.',
      },
      {
        name: "Come back to an earlier question",
        steps: [
          "Pick it from the list on the left.",
          "Rename or delete it with the icons that appear on hover.",
        ],
        gotcha:
          "Results older than a day need a re-run to show their list again — the numbers may have moved since you asked.",
      },
    ],
    related: ["/reports/students"],
  },
  {
    path: "/reports/students",
    title: "Student Report",
    purpose: "One builder for every student list — pick the students, pick the columns, get a sheet.",
    tasks: [
      {
        name: "Build a report",
        steps: [
          'On the "Basics" tab set "Session *" and tick the classes you want (none = all).',
          'Add filters on the "Demographics", "Enrolment" and "Sorting" tabs.',
          'Tick columns in the "Display / Print Fields" panel on the right.',
          'Click "Preview".',
        ],
        needs: "A session must be selected.",
        gotcha:
          "Preview shows only the first 50 rows; exports are unpaged. Fields marked PII are admin-only and are dropped silently for editors, with a \"columns withheld\" badge.",
      },
      {
        name: "Save a preset",
        steps: [
          "Set up the filters and fields.",
          'Type a name into "Save current selection as".',
          'Click "Save", and reload it later from the "Saved report" dropdown.',
        ],
        gotcha:
          "The session is deliberately stripped before saving — a preset is a shape, not a year, so it loads against whatever session you currently have picked.",
      },
      {
        name: "Export",
        steps: ['Click "CSV", "Excel" or "PDF" in the header.'],
        gotcha:
          "PDF is disabled past a column limit — use Excel for wide reports.",
      },
    ],
    related: ["/reports/ask", "/fees/dues", "/attendance"],
  },

  // ── Teacher portal ───────────────────────────────────────────────────────
  // Every class picker here is limited to classes you teach a subject in, plus
  // any class you are the class teacher of. URL-tampering into another class
  // is refused by the server.
  {
    path: "/teacher",
    title: "Teacher dashboard",
    purpose: "Today at a glance — next class, whether attendance is marked, and pending result entry.",
    tasks: [
      {
        name: "Get to today's work",
        steps: [
          'Read the "Next class" card and the "Attendance Today" tile.',
          'Use Quick Actions: "Mark Attendance", "Enter Results", "View Students", "View Timetable".',
        ],
      },
      {
        name: "Clear pending result entry",
        steps: [
          'Scroll to "Results pending your entry".',
          "Click a row — it opens the results screen already filtered.",
        ],
        gotcha: "The section is hidden entirely when nothing is pending.",
      },
    ],
    related: ["/teacher/attendance", "/teacher/results"],
  },
  {
    path: "/teacher/attendance",
    title: "Mark Attendance",
    purpose: "Mark or update a class's attendance for a day.",
    tasks: [
      {
        name: "Mark a class's attendance",
        steps: [
          'Choose a class and set the "Date".',
          'Optionally click "Mark All Present".',
          "Set Present, Absent or Late per student.",
          'Click "Submit Attendance".',
        ],
        gotcha:
          "Future dates are refused. Column filters only change what is displayed — submitting posts EVERY student in the roster, not just the visible rows. If attendance already exists you can edit and resubmit.",
      },
    ],
    related: ["/teacher", "/teacher/students"],
  },
  {
    path: "/teacher/results",
    title: "Enter Results",
    purpose:
      "Enter exam marks for one class, subject and exam — and report-card remarks if you are the class teacher.",
    tasks: [
      {
        name: "Enter and save marks",
        steps: [
          "Set Class, Subject and Exam Type.",
          "Type each student's marks — the Grade fills automatically.",
          'Click "Save All".',
        ],
        gotcha:
          "Save is disabled while any entry exceeds the max marks for that exam.",
      },
      {
        name: "Add report-card remarks",
        steps: [
          "Select the class, subject and exam.",
          'Type into the "Class Teacher Remarks" column.',
          'Optionally click "Draft remarks with AI" to fill only the empty boxes from each student\'s own marks and attendance.',
          'Click "Save All".',
        ],
        needs:
          "You must be the CLASS TEACHER for that class. A subject teacher who is not the class teacher never sees this column or the AI button.",
        gotcha:
          "Remarks are shared across all subjects for that exam, not per subject. The AI draft is not saved until you press Save All.",
      },
      {
        name: "Import marks from CSV",
        steps: [
          'Click "Import CSV" and then "Download template".',
          'Upload the file and click "Preview".',
          'Click "Apply import".',
        ],
        gotcha:
          "The CSV needs an admission number or roll number plus the marks. Blank marks are skipped, not zeroed. Imported rows arrive unpublished — an admin still has to publish them.",
      },
    ],
    related: ["/teacher/class-tests", "/teacher/non-scholastic", "/exams/publish"],
  },
  {
    path: "/teacher/class-diary",
    title: "Class Diary",
    purpose:
      "Send today's homework, holiday homework, notices and photos to the classes you teach, in place of the class WhatsApp group.",
    tasks: [
      {
        name: "Post today's homework",
        steps: [
          'Click "New Post".',
          'Leave the Type on "Homework" and tick your class under Classes.',
          'Pick the Subject, then fill "Title" and "Details".',
          'Optionally set "Submit by (optional)" and click "Attach photos or PDFs" for a worksheet.',
          'Click "Post".',
        ],
        needs:
          "You must be the class teacher or a subject teacher of the class (Academics → Subjects & Assignments). Otherwise the class is not in your list.",
        gotcha:
          "Families only see posts once their child is enrolled in the class for the current session and they have a portal login.",
      },
      {
        name: "Share function photos",
        steps: [
          'Click "New Post" and choose "Photos".',
          'Click "Attach photos or PDFs" and pick up to 10 photos.',
          'Click "Post".',
        ],
        gotcha: "Photos are resized before upload, so large phone photos are fine. Each file must be 10 MB or smaller.",
      },
    ],
    related: ["/teacher/attendance"],
  },
  {
    path: "/teacher/class-tests",
    title: "Class Tests",
    purpose: "Your own unit tests and formative assessments, per class and subject.",
    tasks: [
      {
        name: "Create a class test",
        steps: [
          "Select Class and Subject.",
          'Click "New Test".',
          'Fill "Name", "Date", "Max marks" and optionally "Weightage (%, optional)".',
          'Click "Create".',
        ],
      },
      {
        name: "Enter marks and publish",
        steps: [
          'Click "Enter Marks" on the test row.',
          'Type the marks and click "Save Marks".',
          "Click the eye icon on the row to publish it.",
        ],
        gotcha:
          "New tests start as Draft. Publishing is what makes them count downstream. Deleting a test also deletes all its marks.",
      },
    ],
    related: ["/teacher/results"],
  },
  {
    path: "/teacher/non-scholastic",
    title: "Non-Scholastic",
    purpose: "Grade co-scholastic sub-skills on a letter scale.",
    tasks: [
      {
        name: "Grade a class",
        steps: [
          "Pick Class, Exam Type and Co-scholastic Subject.",
          'Choose a grade in each cell ("—" clears it).',
          'Click "Save All".',
        ],
        needs: "An admin must have configured sub-subjects under Exams → Non-Scholastic Masters.",
      },
    ],
    related: ["/teacher/results"],
  },
  {
    path: "/teacher/ptm-notes",
    title: "PTM Notes",
    purpose: "Record parent-meeting attendance, remarks and action points per student.",
    tasks: [
      {
        name: "Record a meeting",
        steps: [
          'Pick a "Class" and a "Meeting date".',
          "Fill attendance and the remark columns.",
          'Click "Save meeting".',
        ],
        needs: "Both a class and a date — the grid stays hidden until both are set.",
        gotcha: "Data is keyed on the meeting date, so changing the date shows a different set.",
      },
    ],
    related: ["/teacher/results"],
  },
  {
    path: "/teacher/timetable",
    title: "My Timetable",
    purpose: "Read-only view of your own teaching week.",
    tasks: [
      {
        name: "Change your timetable",
        steps: [
          "You cannot — this page is read-only for teachers.",
          "An admin edits it under Timetable → Class Timetable.",
        ],
        gotcha: "Substitutions assigned to you are not shown here.",
      },
    ],
    related: ["/timetable"],
  },
  {
    path: "/teacher/students",
    title: "Class Rosters",
    purpose: "Look up who is in the classes you teach.",
    tasks: [
      {
        name: "Find a student",
        steps: [
          "Pick a class.",
          'Type into "Search by name...".',
        ],
        gotcha:
          "Read-only, and limited to roll, name, email and phone. Nothing about fees, attendance or results is shown here.",
      },
    ],
    related: ["/teacher/attendance"],
  },
  {
    path: "/teacher/calendar",
    title: "School Calendar",
    purpose: "Upcoming school-wide events plus anything scheduled for your classes.",
    tasks: [
      {
        name: "Add an event",
        steps: [
          "You cannot — this view is read-only.",
          "Events are created by an admin under Calendar.",
        ],
      },
    ],
    related: ["/calendar"],
  },
];

/**
 * Longest-prefix lookup, so /people/students/abc123 resolves to the students
 * screen and a query string is ignored.
 */
export function findScreenGuide(pathname: string): ScreenGuide | null {
  const path = (pathname.split("?")[0] || "/").replace(/\/+$/, "") || "/";

  let best: ScreenGuide | null = null;
  for (const guide of SCREEN_GUIDES) {
    const match =
      guide.path === path ||
      (guide.path !== "/" && path.startsWith(`${guide.path}/`));
    if (!match) continue;
    if (!best || guide.path.length > best.path.length) best = guide;
  }
  return best;
}

/**
 * The compact map that goes in the cached system prefix.
 *
 * Path, title, purpose and task NAMES only — the steps are fetched on demand.
 * Sending everything would put the whole file in every request; sending only
 * paths would leave the model unable to answer "where do I do X?" without a
 * round trip. Naming the tasks is the middle that answers most questions in
 * one hop.
 */
export function guideIndex(): string {
  return SCREEN_GUIDES.map(
    (g) => `${g.path} — ${g.title}: ${g.purpose} [${g.tasks.map((t) => t.name).join("; ")}]`
  ).join("\n");
}

/** Every path the guide knows. Used to decide which links may be rendered. */
export function guidePaths(): string[] {
  return SCREEN_GUIDES.map((g) => g.path);
}

/**
 * Jobs that span several screens.
 *
 * The screen registry answers "how do I do X *here*". It cannot answer "how do
 * I set up exams?", because the answer is six screens in a fixed order and no
 * single entry knows about the other five. Those are the questions a new user
 * actually asks, and answering them by stitching together screen entries
 * produces something that is individually correct and collectively useless —
 * it leaves out the order, which is the entire content of the question.
 *
 * Diagnostics live here too. "Report cards are blank" is not a screen, it is a
 * symptom with three or four candidate causes across the module.
 */
export interface Workflow {
  /** Stable id the model asks for. */
  id: string;
  /** What someone would call it. */
  title: string;
  /** One line, shown in the cached index. */
  summary: string;
  /** Ordered. Each step names the screen it happens on. */
  steps: { path: string; what: string; why?: string }[];
  /** What goes wrong, in the order it usually goes wrong. */
  pitfalls?: string[];
}

export const WORKFLOWS: Workflow[] = [
  {
    id: "exam-setup",
    title: "Set up exams and report cards from scratch",
    summary:
      "The fixed order for a new class or year — masters before operations, or results compute as zero.",
    steps: [
      {
        path: "/academics/years",
        what: "Make sure the academic year exists and is marked current.",
      },
      {
        path: "/academics/classes",
        what: "Create the classes, with a class teacher.",
      },
      {
        path: "/academics/subjects",
        what: "Assign subjects to each class on the Class Assignments tab.",
        why: "Result Master has nothing to offer until a class has subjects.",
      },
      {
        path: "/exams/grade-master",
        what: "Create a grade scale and apply it to the classes.",
        why: "With no scale, marks compute but every letter grade prints blank.",
      },
      {
        path: "/exams/types",
        what: "Create each exam for the year and balance the level to 100%.",
      },
      {
        path: "/exams/result-master",
        what:
          'Create the master, then work through all three tabs: Basic Rules, Subjects (at least one Main), and Advanced — where you MUST press "Save Advanced Settings".',
        why: "The Advanced weightage grid is the step everyone skips, and skipping it makes every subject score zero.",
      },
      {
        path: "/teacher/results",
        what: "Teachers enter marks for their class and subject.",
      },
      {
        path: "/exams/publish",
        what: "Stage 1 publishes marks to parents; Stage 2 freezes the marksheet PDFs.",
      },
    ],
    pitfalls: [
      "The Advanced tab pre-fills from the exam types, so it LOOKS configured. Nothing is saved until you press the button, and there is no warning anywhere.",
      "A Result Master with zero subjects behaves exactly like no Result Master at all.",
      "Finalizing before the weightage is right freezes the zeros into the official PDFs. Fixing the marks afterwards does not change them — you have to re-finalize.",
    ],
  },
  {
    id: "zero-results",
    title: "Report cards are blank or showing zero",
    summary: "The four causes, in the order they are worth checking.",
    steps: [
      {
        path: "/exams/result-master",
        what:
          'Open Advanced for that class and check the weightage chip reads "Sum: 100%". If the grid is empty or was never saved, that is your answer.',
        why: "An exam with no weightage contributes nothing, so every subject computes as zero.",
      },
      {
        path: "/exams/result-master",
        what: "Check the Subjects tab has at least one subject with Role = Main.",
        why: "Only Main subjects feed the aggregate.",
      },
      {
        path: "/exams/grade-master",
        what: "If marks show but grades are blank, no grade scale resolves for the class.",
      },
      {
        path: "/exams/publish",
        what:
          "If it looks right to you but parents see nothing, the marks were never published — Stage 1.",
      },
    ],
    pitfalls: [
      "Result Master → Preview reads live data, so it shows marks parents cannot see. \"Works for me, blank for them\" is almost always Stage 1.",
      "Already-finalized marksheets are frozen snapshots. Correcting the config does not update them.",
    ],
  },
  {
    id: "new-session",
    title: "Roll over to a new academic session",
    summary: "What has to be recreated for a new year, including the things that silently read as zero.",
    steps: [
      { path: "/academics/years", what: 'Add the new year, then "Set Current".' },
      { path: "/academics/classes", what: "Create the classes for the new year." },
      {
        path: "/people/students",
        what:
          "For each outgoing class: mark every student passed or failed, then Actions → Promote Class into the new year.",
        why: "Promote refuses while anyone in the class is still 'active'.",
      },
      {
        path: "/fees/academic",
        what: "Build the fee schedule for each class in the new year.",
      },
      {
        path: "/transport/stops",
        what: "Set every stop's monthly fee again.",
        why: "Transport fees are stored per academic year, so a new session starts at zero for every stop.",
      },
      {
        path: "/exams/result-master",
        what: "Create the Result Master for each class in the new year.",
      },
    ],
    pitfalls: [
      "The transport fee reset is the quiet one — transport billing simply reads as zero and nothing complains.",
      "Class XII passers become alumni on promotion; failed students are re-enrolled in the same class.",
    ],
  },
  {
    id: "fees-setup",
    title: "Start collecting fees for a class",
    summary: "Why the Fee dropdown on Record Payment is empty, and what fills it.",
    steps: [
      {
        path: "/fees/academic",
        what:
          "On Fee Schedule, pick the class (and stream for XI/XII), add a row per instalment, and Save.",
        why: "Record Payment reads its Fee dropdown from this. No schedule, no dropdown.",
      },
      {
        path: "/fees/academic",
        what: 'Once saved, use "Copy to classes" for the rest.',
      },
      {
        path: "/fees/payments",
        what: "Find the student, click Record Payment, pick the instalment.",
      },
      { path: "/fees/dues", what: "The arrears register now has real numbers." },
    ],
    pitfalls: [
      "A transport line only appears on Record Payment if the student has a stop assigned AND that stop carries a fee for this year.",
      'Dues are counted as of today — "Due Till Date" and "Annual Fee" are deliberately different numbers.',
    ],
  },
  {
    id: "transport-setup",
    title: "Put a student on the school bus",
    summary: "Stop, then route, then student — each step unlocks the next.",
    steps: [
      {
        path: "/transport/stops",
        what: "Add the stop, then set its monthly fee with the rupee icon.",
      },
      {
        path: "/people/staff",
        what: 'Add the driver as staff with category "Bus Drivers".',
      },
      {
        path: "/transport/buses",
        what: "Register the bus, then use the route icon to tick the stops it serves.",
        why: "A student whose stop is on no route gets no bus suggestion.",
      },
      {
        path: "/transport/assignments",
        what:
          'Open the student, tick "Uses school transport", pick the stop and bus, and set the direction.',
      },
    ],
    pitfalls: [
      "A one-way rider needs a custom one-side fee, or the save is refused — the flat stop fee covers both legs.",
      "Removing a student from transport clears the whole year's unpaid transport dues, including months already ridden.",
    ],
  },
  {
    id: "new-teacher",
    title: "Get a new teacher working in the system",
    summary: "The conversion step people miss, and why nobody can select them until it happens.",
    steps: [
      {
        path: "/people/staff",
        what: 'Add them with a teaching category and an email address.',
      },
      {
        path: "/people/staff",
        what: "Click the graduation-cap icon to convert them to a teacher record.",
        why:
          "Until this is done they appear in NO class-teacher or subject-teacher dropdown anywhere in the ERP.",
      },
      {
        path: "/people/staff",
        what: "Click the person-plus icon to create their portal login (admin only).",
      },
      {
        path: "/academics/subjects",
        what: "On Class Assignments, set them as the teacher for their subjects.",
      },
      {
        path: "/academics/classes",
        what: "If they are a class teacher, set that on the class.",
        why:
          "Report-card remarks are limited to the class teacher specifically, not to anyone teaching the class.",
      },
    ],
    pitfalls: [
      "Bus drivers and peons cannot be given a portal login at all.",
      "No email on the staff row means no login can be created.",
    ],
  },
  {
    id: "onboard-students",
    title: "Load a new intake of students",
    summary: "Bulk upload, and what it does to students who already exist.",
    steps: [
      { path: "/academics/classes", what: "Make sure the classes exist first." },
      {
        path: "/people/students",
        what: 'Actions → Upload Excel, then "Download Template" and fill it.',
        why: "Only Admission No, Name and Class are required; missing classes are auto-created.",
      },
      {
        path: "/people/students",
        what: "Review the preview, fix what it flags, then import.",
      },
      {
        path: "/academics/classes",
        what: "Generate roll numbers for each class.",
      },
      {
        path: "/people/students",
        what: 'Tick the rows and use "Create Users" for portal logins (admin only).',
      },
    ],
    pitfalls: [
      "Re-uploading an existing admission number UPDATES that student. A blank cell clears the stored value; a column left out entirely is untouched.",
      "The header checkbox selects every student matching the filters, not just the visible page.",
    ],
  },
  {
    id: "parents-cant-see",
    title: "Parents or students cannot see something",
    summary: "The publish gates, one per kind of content.",
    steps: [
      {
        path: "/exams/publish",
        what: "Exam marks and report cards: Stage 1 · Online Publish for that class and exam.",
      },
      {
        path: "/teacher/class-tests",
        what: "Class tests: the eye icon on the test row. They are separate from exam publishing.",
      },
      {
        path: "/exams/non-scholastic-assessments",
        what:
          "Co-scholastic grades: published by Stage 1 too, but they only reach the report card if Result Master → Advanced has them switched on.",
      },
      {
        path: "/calendar",
        what: 'Calendar events: the "Show on public website" tick on the event.',
      },
    ],
  },
];

/** Compact list for the cached prefix — ids, titles and one line each. */
export function workflowIndex(): string {
  return WORKFLOWS.map((w) => `${w.id} — ${w.title}: ${w.summary}`).join("\n");
}

export function findWorkflow(id: string): Workflow | null {
  return WORKFLOWS.find((w) => w.id === id) ?? null;
}
