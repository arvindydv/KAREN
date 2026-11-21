/** Text value of a form field ('' for missing fields or file inputs). */
export const formText = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};
