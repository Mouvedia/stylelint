import { RULE_NAME_ALL } from '../constants.mjs';
import { isNumber } from './validateTypes.mjs';

/**
 * Report a problem.
 *
 * This function accounts for `disabledRanges` attached to the result.
 * That is, if the reported problem is within a disabledRange,
 * it is ignored. Otherwise, it is attached to the result as a
 * postcss warning.
 *
 * It also accounts for the rule's severity.
 *
 * You *must* pass *either* a node or a line number.
 *
 * @type {import('stylelint').Utils['report']}
 */
export default function report(problem) {
	const {
		index,
		endIndex,
		start,
		end,
		fix,
		line,
		message,
		messageArgs,
		node,
		result,
		result: {
			stylelint: { config = {} },
		},
		ruleName,
		severity,
		word,
	} = problem;

	const hasRange = end?.column && start;
	const hasIndexes = isNumber(index) && isNumber(endIndex);
	const hasRangeData = hasRange || hasIndexes;
	const hasFix = typeof fix === 'function';
	const hasFixData = config.fix && hasRangeData;

	if (hasFix && !hasRangeData) {
		throw new Error(
			`The fix callback for rule "${ruleName}" requires either index/endIndex or start/end to be passed to the \`report()\` function.`,
		);
	}

	if (hasFixData) {
		const range = hasRange ? { start, end } : node.rangeBy({ index, endIndex });

		if (hasFix) return applyFix({ fix, result, ruleName, range });
	}

	const ruleSeverityOption = severity || result.stylelint.ruleSeverities[ruleName];
	const defaultSeverity = config.defaultSeverity || 'error';
	const ruleSeverity =
		typeof ruleSeverityOption === 'function'
			? ruleSeverityOption(...(messageArgs || [])) || defaultSeverity
			: ruleSeverityOption;

	// In quiet mode, mere warnings are ignored
	if (result.stylelint.quiet && ruleSeverity !== 'error') {
		return;
	}

	// endIndex is optional
	const reportRange = (node && node.rangeBy({ index, endIndex })) || {};

	// If a line is not passed, use the node.rangeBy method to get the
	// line number that the complaint pertains to
	const startLine = line || reportRange.start?.line;

	if (!startLine) {
		throw new Error(
			`The "${ruleName}" rule failed to pass either a node or a line number to the \`report()\` function.`,
		);
	}

	const { ignoreDisables } = config;
	const { disabledRanges } = result.stylelint;

	if (disabledRanges) {
		const ranges = disabledRanges[ruleName] ?? disabledRanges[RULE_NAME_ALL] ?? [];

		for (const range of ranges) {
			if (
				// If the problem is within a disabledRange,
				// and that disabledRange's rules include this one,
				// do not register a warning
				range.start <= startLine &&
				(range.end === undefined || range.end >= startLine) &&
				(!range.rules || range.rules.includes(ruleName))
			) {
				// Collect disabled warnings
				// Used to report `needlessDisables` in subsequent processing.
				const disabledWarnings =
					result.stylelint.disabledWarnings || (result.stylelint.disabledWarnings = []);

				disabledWarnings.push({
					rule: ruleName,
					line: startLine,
				});

				if (!ignoreDisables) {
					return;
				}

				break;
			}
		}
	}

	if (!result.stylelint.stylelintError && ruleSeverity === 'error') {
		result.stylelint.stylelintError = true;
	}

	if (!result.stylelint.stylelintWarning && ruleSeverity === 'warning') {
		result.stylelint.stylelintWarning = true;
	}

	/** @type {import('stylelint').WarningOptions} */
	const warningProperties = {
		severity: ruleSeverity,
		rule: ruleName,
	};

	if (node) {
		warningProperties.node = node;
	}

	if (start) {
		warningProperties.start = start;
	} else if (typeof index === 'number') {
		warningProperties.index = index;
	}

	if (end) {
		warningProperties.end = end;
	} else if (typeof endIndex === 'number') {
		warningProperties.endIndex = endIndex;
	}

	if (word) {
		warningProperties.word = word;
	}

	const { customMessages } = result.stylelint;
	const warningMessage = buildWarningMessage(
		(customMessages && customMessages[ruleName]) || message,
		messageArgs,
	);

	result.warn(warningMessage, warningProperties);
}

/**
 * @param {import('stylelint').RuleMessage} message
 * @param {import('stylelint').Problem['messageArgs']} messageArgs
 * @returns {string}
 */
function buildWarningMessage(message, messageArgs) {
	const args = messageArgs || [];

	if (typeof message === 'string') {
		return printfLike(message, ...args);
	}

	return message(...args);
}

/**
 * @param {string} format
 * @param {Array<unknown>} args
 * @returns {string}
 */
function printfLike(format, ...args) {
	return args.reduce((/** @type {string} */ result, arg) => {
		return result.replace(/%[ds]/, String(arg));
	}, format);
}

/** @typedef {import('stylelint').DisabledRange} DisabledRange */
/** @typedef {import('stylelint').FixerData} FixerData */
/** @typedef {import('stylelint').Problem} Problem */

/**
 * even though stylelint-disable comments cannot be inserted inside a declaration or a selector list,
 * new lines cannot be disregarded because FixerData['range'] is exposed through StylelintPostcssResult['fixersData']
 * i.e. ranges must be accurate to be exploited
 * @see stylelint/stylelint#7192
 * @summary apply fix while taking into account the disabled ranges
 * @param {object} o
 * @param {NonNullable<Problem['fix']>} o.fix
 * @param {Problem['result']} o.result
 * @param {Problem['ruleName']} o.ruleName
 * @param {FixerData['range']} o.range
 */
function applyFix({ fix, result, ruleName, range }) {
	const {
		disabledRanges,
		disabledRanges: { all = [] },
		config,
		fixersData,
	} = result.stylelint;
	const isInRange = (/** @type {DisabledRange} */ { start, end }) =>
		range.start.line >= start && (!end || range.start.line <= end);
	const ranges = disabledRanges[ruleName] ?? all;
	const mayFix = config?.ignoreDisables || !ranges.length || !ranges.some(isInRange);
	const array = fixersData[ruleName] || (fixersData[ruleName] = []);

	array.push({ range, fixed: mayFix });

	if (mayFix) fix();
}
