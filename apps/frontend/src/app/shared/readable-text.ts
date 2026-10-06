import { Pipe, PipeTransform } from '@angular/core';
import { readableText, type NamedRecord } from './record-labels';

@Pipe({ name: 'readable', standalone: true })
export class ReadableText implements PipeTransform {
  transform(text: string | null | undefined, ...sources: readonly NamedRecord[][]): string {
    return readableText(text, ...sources);
  }
}
