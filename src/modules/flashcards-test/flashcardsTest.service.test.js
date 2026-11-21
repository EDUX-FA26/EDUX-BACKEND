const FlashcardsTestService = require('./flashcardsTest.service');

describe('FlashcardsTestService._gradeAnswer', () => {
  const optionsStringArray = ['5/8', '7/8', '1', '3/8'];
  const optionsWithPrefix = ['A. 5/8', 'B. 7/8', 'C. 1', 'D. 3/8'];
  const optionsObjects = [
    { key: 'A', text: '5/8' },
    { key: 'B', text: '7/8' },
    { key: 'C', text: '1' },
    { key: 'D', text: '3/8' },
  ];

  test('grades correct when student submits text and real answer is text', () => {
    expect(FlashcardsTestService._gradeAnswer('multiple_choice', '7/8', '7/8', optionsStringArray)).toBe(true);
    expect(FlashcardsTestService._gradeAnswer('multiple_choice', '5/8', '7/8', optionsStringArray)).toBe(false);
  });

  test('grades correct when student submits letter key B and real answer is text 7/8 with string array options', () => {
    expect(FlashcardsTestService._gradeAnswer('multiple_choice', 'B', '7/8', optionsStringArray)).toBe(true);
    expect(FlashcardsTestService._gradeAnswer('multiple_choice', 'b', '7/8', optionsStringArray)).toBe(true);
    expect(FlashcardsTestService._gradeAnswer('multiple_choice', 'A', '7/8', optionsStringArray)).toBe(false);
  });

  test('grades correct when student submits text 7/8 and real answer is letter key B', () => {
    expect(FlashcardsTestService._gradeAnswer('multiple_choice', '7/8', 'B', optionsStringArray)).toBe(true);
    expect(FlashcardsTestService._gradeAnswer('multiple_choice', '5/8', 'B', optionsStringArray)).toBe(false);
  });

  test('grades correct with options containing prefixes A. B. C. D.', () => {
    expect(FlashcardsTestService._gradeAnswer('multiple_choice', 'B', '7/8', optionsWithPrefix)).toBe(true);
    expect(FlashcardsTestService._gradeAnswer('multiple_choice', '7/8', '7/8', optionsWithPrefix)).toBe(true);
    expect(FlashcardsTestService._gradeAnswer('multiple_choice', 'B. 7/8', '7/8', optionsWithPrefix)).toBe(true);
  });

  test('grades correct with object options', () => {
    expect(FlashcardsTestService._gradeAnswer('multiple_choice', 'B', '7/8', optionsObjects)).toBe(true);
    expect(FlashcardsTestService._gradeAnswer('multiple_choice', '7/8', '7/8', optionsObjects)).toBe(true);
    expect(FlashcardsTestService._gradeAnswer('multiple_choice', '7/8', 'B', optionsObjects)).toBe(true);
  });

  test('handles case 2 from user image: 2,5 * 4 = 10', () => {
    const opts = ['8', '9', '10', '12'];
    expect(FlashcardsTestService._gradeAnswer('multiple_choice', 'C', '10', opts)).toBe(true);
    expect(FlashcardsTestService._gradeAnswer('multiple_choice', '10', '10', opts)).toBe(true);
  });
});
