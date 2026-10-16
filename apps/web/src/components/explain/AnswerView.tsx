/**
 * explain/AnswerView — moved. The answer is drawn as an exchange (`features/explain`, #202); the
 * interface lines around it live in `features/explain/components/AnswerStates`. This re-export
 * keeps `SummaryView` and older imports working.
 */
export {
  FailureNote,
  formatUsage,
  StatusLine,
  UsageLine,
} from '@/features/explain/components/AnswerStates';
