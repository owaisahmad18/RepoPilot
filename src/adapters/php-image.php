<?php

declare(strict_types=1);

use Intervention\Image\Direction;
use Intervention\Image\Drivers\Gd\Driver;
use Intervention\Image\Format;
use Intervention\Image\ImageManager;

[$script, $repository, $input, $output, $payloadJson] = $argv;
require $repository . DIRECTORY_SEPARATOR . 'vendor' . DIRECTORY_SEPARATOR . 'autoload.php';
$values = json_decode($payloadJson, true, flags: JSON_THROW_ON_ERROR);
$manager = new ImageManager(new Driver());
$image = $manager->decodePath($input);
$operation = $values['operation'] ?? 'resize';
$integer = static fn (string $key, ?int $fallback = null): ?int =>
    ($values[$key] ?? '') === '' ? $fallback : (int) $values[$key];
$decimal = static fn (string $key, ?float $fallback = null): ?float =>
    ($values[$key] ?? '') === '' ? $fallback : (float) $values[$key];

switch ($operation) {
    case 'resize': $image->resize($integer('width'), $integer('height')); break;
    case 'scale': $image->scale($integer('width'), $integer('height')); break;
    case 'cover': $image->cover($integer('width'), $integer('height')); break;
    case 'crop': $image->crop($integer('width'), $integer('height'), $integer('x', 0), $integer('y', 0)); break;
    case 'rotate': $image->rotate($decimal('angle', 90)); break;
    case 'blur': $image->blur($integer('level', 5)); break;
    case 'sharpen': $image->sharpen($integer('level', 5)); break;
    case 'flip': $image->flip(($values['direction'] ?? 'horizontal') === 'vertical' ? Direction::VERTICAL : Direction::HORIZONTAL); break;
    case 'grayscale': $image->grayscale(); break;
    default: throw new InvalidArgumentException("Unsupported image operation: {$operation}");
}

$format = Format::create($values['format'] ?? 'jpeg');
$quality = max(1, min(100, (int) ($values['quality'] ?? 85)));
$image->encodeUsingFormat($format, quality: $quality)->save($output);
fwrite(STDOUT, "Saved image: {$output}" . PHP_EOL);
