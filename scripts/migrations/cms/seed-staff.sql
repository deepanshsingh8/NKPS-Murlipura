-- Seed staff_members table from hardcoded STAFF constant
-- Run this once in Supabase SQL Editor after creating the staff_members table

INSERT INTO staff_members (name, subject, category, sort_order) VALUES
  -- Management
  ('Kavia Prema', 'Principal', 'management', 0),
  ('Gaurav Kumar Mathur', 'Vice Principal', 'management', 1),
  ('Ramavtar Khunteta', 'Senior Coordinator', 'management', 2),
  ('Neelam Pandey', 'Pre-Primary Coordinator', 'management', 3),
  -- PGT (Post-Graduate Teachers)
  ('Jasvindar Singh Bhatiya', 'Biology', 'pgt', 0),
  ('Vijay Kumar Soni', 'Chemistry', 'pgt', 1),
  ('Arshad Ali Khan', 'Accountancy', 'pgt', 2),
  ('Ashutosh Tiwari', 'Economics', 'pgt', 3),
  ('Shailendra Singh', 'Physics', 'pgt', 4),
  ('Shivendra Singh Yadav', 'Physical Education', 'pgt', 5),
  ('Sunil Kumar Bhardwaj', 'Information Practices', 'pgt', 6),
  ('Pradeep Sharma', 'History', 'pgt', 7),
  ('Jatirmoy Samadder', 'Mathematics', 'pgt', 8),
  ('Nisha Sharma', 'Music', 'pgt', 9),
  ('Indu Sharma', 'Painting', 'pgt', 10),
  ('Santosh Kanwar', 'English', 'pgt', 11),
  ('Hemant Kumar Yogi', 'Political Science', 'pgt', 12),
  -- TGT (Trained Graduate Teachers)
  ('Neha Rathi', 'English', 'tgt', 0),
  ('Shubham Aggarwal', 'Mathematics', 'tgt', 1),
  ('Sunita Bugaliya', 'Hindi', 'tgt', 2),
  ('Soniya Sharma', 'Hindi', 'tgt', 3),
  ('Nita Sharma', 'English', 'tgt', 4),
  ('Priyanka Sharma', 'Social Science', 'tgt', 5),
  ('Himanshu Kumawat', 'Science', 'tgt', 6),
  ('Vijaya Sharma', 'Science', 'tgt', 7),
  ('Rahul Prajapat', 'Computer Science', 'tgt', 8),
  ('Ramesh Chandra Sharma', 'Sanskrit', 'tgt', 9),
  ('Sneha Sharma', 'Science', 'tgt', 10),
  -- PRT (Primary Teachers)
  ('Khushi Jain', 'Mathematics', 'prt', 0),
  ('Poonam Sharma', 'Staff Secretary', 'prt', 1),
  ('Usha Rajawat', 'General', 'prt', 2),
  ('Vijay Laxmi', 'Hindi', 'prt', 3),
  ('Neha Sharma', 'English', 'prt', 4),
  ('Sumati Saini', 'Computer', 'prt', 5),
  ('Sonu Kumawat', 'English', 'prt', 6),
  ('Meenakshi', 'Hindi', 'prt', 7),
  ('Shivani Gaur', 'Mathematics', 'prt', 8),
  ('Kalpana Negi', 'Mathematics', 'prt', 9),
  -- Mother Teachers
  ('Neha Gautam', 'Mother Teacher', 'motherTeachers', 0),
  ('Nitu Sinha', 'Mother Teacher', 'motherTeachers', 1),
  ('Mamta Agarwal', 'Mother Teacher', 'motherTeachers', 2);
