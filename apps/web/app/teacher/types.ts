import type { Classroom, Institution } from '@alumini/types';

export interface TeacherClassroom extends Classroom {
  userRole: string;
  verificationStatus: string;
  isActive: boolean;
}

export interface InstitutionGroup {
  institution: Institution;
  classes: TeacherClassroom[];
}
